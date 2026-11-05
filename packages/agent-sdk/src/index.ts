/**
 * @leash/agent-sdk — a drop-in `fetch` for agents that pays x402 endpoints under Leash's rules.
 *
 *   const leash = new LeashAgent({ apiUrl, apiKey, agentPrivateKey, hotAccount, vaultAccount });
 *   const res = await leash.fetch("https://api.example.com/forecast");   // pays if 402
 *
 * Flow on a 402:
 *   1. decode PAYMENT-REQUIRED, pick a Hedera "exact" requirement
 *   2. ask Leash (POST /agent/intents) -> auto | pending | denied
 *   3. auto    -> sign from the HOT wallet with the agent key (official x402 Hedera signer)
 *      pending -> wait for the owner's World ID approval, then build the transfer FROM THE VAULT,
 *                 sign with the agent key, and have Leash co-sign (2-of-3)
 *   4. retry with PAYMENT-SIGNATURE, read PAYMENT-RESPONSE, report the settlement to Leash
 */
import { AccountId, Client, Hbar, PrivateKey, TokenId, TransactionId, TransferTransaction } from "@hiero-ledger/sdk";
import { createClientHederaSigner, type ClientHederaSigner } from "@x402/hedera";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";

export class LeashDenied extends Error {
  constructor(
    message: string,
    public reasons: string[] = [],
    public status?: string,
  ) {
    super(message);
  }
}

export interface LeashAgentConfig {
  apiUrl: string; // e.g. http://localhost:4000/v1
  apiKey: string;
  agentPrivateKey: string; // DER
  hotAccount: string;
  vaultAccount: string;
  network?: "hedera:testnet" | "hedera:mainnet";
  fetch?: typeof globalThis.fetch;
  /** How long to wait for the human (seconds). Default 600. */
  approvalTimeoutSec?: number;
  log?: (msg: string, data?: unknown) => void;
}

export interface PayEvents {
  onDecision?: (d: { decision: string; intentId: string; reasons: string[]; approvalId?: string }) => void;
  onApproved?: (intentId: string) => void;
}

type Decision =
  | { decision: "auto"; intentId: string; reasons: string[]; payFrom: string }
  | { decision: "pending"; intentId: string; approvalId: string; reasons: string[]; payFrom: string; expiresAt: number }
  | { decision: "denied"; intentId: string; reasons: string[] };

export class LeashAgent {
  private key: PrivateKey;
  private f: typeof globalThis.fetch;
  private network: "hedera:testnet" | "hedera:mainnet";
  private log: (m: string, d?: unknown) => void;

  constructor(private cfg: LeashAgentConfig) {
    this.key = PrivateKey.fromStringDer(cfg.agentPrivateKey);
    this.f = cfg.fetch ?? globalThis.fetch.bind(globalThis);
    this.network = cfg.network ?? "hedera:testnet";
    this.log = cfg.log ?? (() => {});
  }

  // ---------------------------------------------------------------- Leash API
  async api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(this.cfg.apiUrl + path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Leash ${method} ${path} -> ${res.status}: ${json?.message ?? res.statusText}`) as Error & { code?: string; status?: number };
      err.code = json?.error;
      err.status = res.status;
      throw err;
    }
    return json as T;
  }

  /** Ask the owner to change limits. The agent can never apply it itself. */
  requestPolicyChange(policy: unknown, reason: string) {
    return this.api("POST", "/agent/policy-requests", { policy, reason });
  }

  // ---------------------------------------------------------------- signers
  private hotSigner(): ClientHederaSigner {
    return createClientHederaSigner(this.cfg.hotAccount, this.key, { network: this.network });
  }

  /** Builds the transfer FROM THE VAULT, signs with the agent key, then gets Leash's co-signature. */
  private vaultSigner(intentId: string): ClientHederaSigner {
    const vault = AccountId.fromString(this.cfg.vaultAccount);
    return {
      accountId: vault.toString(),
      createPartiallySignedTransferTransaction: async (req: PaymentRequirements) => {
        const feePayer = req.extra?.feePayer;
        if (typeof feePayer !== "string") throw new Error("feePayer is required in paymentRequirements.extra");
        const amount = BigInt(req.amount);
        const payTo = AccountId.fromString(req.payTo);
        const tx = new TransferTransaction();
        if (req.asset === "0.0.0") {
          tx.addHbarTransfer(vault, Hbar.fromTinybars((-amount).toString())).addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
        } else {
          const token = TokenId.fromString(req.asset);
          tx.addTokenTransfer(token, vault, -amount).addTokenTransfer(token, payTo, amount);
        }
        tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));
        const client = this.network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
        try {
          tx.freezeWith(client); // offline: only sets node ids
          await tx.sign(this.key);
        } finally {
          client.close();
        }
        const mine = Buffer.from(tx.toBytes()).toString("base64");
        const { txBytesBase64 } = await this.api<{ txBytesBase64: string }>("POST", `/agent/intents/${intentId}/cosign`, { txBytesBase64: mine });
        return txBytesBase64;
      },
    };
  }

  // ---------------------------------------------------------------- the main entry point
  async fetch(input: string | URL, init: RequestInit = {}, ev: PayEvents = {}): Promise<Response> {
    const url = String(input);
    const first = await this.f(url, init);
    if (first.status !== 402) return first;

    const required = await readPaymentRequired(first);
    const req = required.accepts.find((a) => a.scheme === "exact" && a.network === this.network);
    if (!req) throw new Error(`no Hedera ${this.network} "exact" payment option offered by ${url}`);

    const decision = await this.api<Decision>("POST", "/agent/intents", {
      network: req.network,
      asset: req.asset,
      payTo: req.payTo,
      amount: req.amount,
      resource: required.resource?.url ?? url,
      description: required.resource?.description?.slice(0, 280),
      feePayer: typeof req.extra?.feePayer === "string" ? req.extra.feePayer : undefined,
    });
    ev.onDecision?.(decision as any);
    this.log(`leash decision: ${decision.decision}`, decision);
    if (decision.decision === "denied") throw new LeashDenied(`payment denied by policy: ${decision.reasons.join(", ")}`, decision.reasons, "denied");

    let signer: ClientHederaSigner;
    let source: "hot" | "vault";
    if (decision.decision === "auto") {
      signer = this.hotSigner();
      source = "hot";
    } else {
      await this.waitForApproval(decision.intentId);
      ev.onApproved?.(decision.intentId);
      signer = this.vaultSigner(decision.intentId);
      source = "vault";
    }

    const transaction = await signer.createPartiallySignedTransferTransaction(req);
    const payload: PaymentPayload = { x402Version: required.x402Version, resource: required.resource, accepted: req, payload: { transaction } };
    const headers = new Headers(init.headers);
    headers.set("PAYMENT-SIGNATURE", encodePaymentSignatureHeader(payload));
    const paid = await this.f(url, { ...init, headers });

    const settleHeader = paid.headers.get("PAYMENT-RESPONSE");
    if (!settleHeader) {
      await this.api("POST", `/agent/intents/${decision.intentId}/cancel`).catch(() => {});
      throw new Error(`merchant did not settle (HTTP ${paid.status})`);
    }
    const settled = decodePaymentResponseHeader(settleHeader);
    if (!settled.success) throw new Error(`settlement failed: ${settled.errorReason ?? "unknown"}`);
    await this.api("POST", `/agent/intents/${decision.intentId}/settled`, { txId: settled.transaction, source });
    this.log(`paid ${req.amount} of ${req.asset} to ${req.payTo} from ${source} (tx ${settled.transaction})`);
    return paid;
  }

  private async waitForApproval(intentId: string) {
    const deadline = Date.now() + (this.cfg.approvalTimeoutSec ?? 600) * 1000;
    this.log("waiting for the owner's World ID approval...");
    while (Date.now() < deadline) {
      const w = await this.api<{ status: string }>("GET", `/agent/intents/${intentId}/wait?timeout=25`);
      if (w.status === "approved_vault") return;
      if (w.status !== "awaiting_approval") throw new LeashDenied(`owner did not approve (${w.status})`, [], w.status);
    }
    await this.api("POST", `/agent/intents/${intentId}/cancel`).catch(() => {});
    throw new LeashDenied("timed out waiting for approval", [], "timeout");
  }
}

async function readPaymentRequired(res: Response): Promise<PaymentRequired> {
  const h = res.headers.get("PAYMENT-REQUIRED");
  if (h) return decodePaymentRequiredHeader(h);
  const body: any = await res.json().catch(() => null);
  if (body?.accepts) return body as PaymentRequired;
  throw new Error("402 without x402 payment requirements");
}
