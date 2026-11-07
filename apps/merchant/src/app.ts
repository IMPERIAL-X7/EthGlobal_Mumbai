/**
 * Demo x402 merchant on Hedera testnet — "Weather Pro" API.
 *
 *  GET /forecast         0.05 USDC  (small: an agent may auto-pay this)
 *  GET /report/premium   2.50 USDC  (large: needs the owner's World ID approval)
 *  GET /invoice/:n       0.40 USDC  (the "pay these invoices" demo task)
 *  GET /attacker/data    0.02 USDC  paid to the ATTACKER account (prompt-injection demo)
 *
 * MERCHANT_FAKE=1 swaps the real facilitator for a local one that settles on Leash's fake
 * ledger (/v1/dev/settle), so the full demo runs offline.
 */
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { Transaction, TransferTransaction } from "@hiero-ledger/sdk";

/** The Hedera account that pays in an x402 payment (the one with a negative transfer), if decodable. */
function payerOf(header: string): string | undefined {
  try {
    const p = decodePaymentSignatureHeader(header) as any;
    const tx = Transaction.fromBytes(Buffer.from(p.payload.transaction, "base64"));
    if (!(tx instanceof TransferTransaction)) return undefined;
    for (const [acct, amt] of tx.hbarTransfers) if (amt.toTinybars().isNegative()) return acct.toString();
    for (const [, m] of tx.tokenTransfers) for (const [acct, amt] of m) if (amt.isNegative()) return acct.toString();
  } catch {}
  return undefined;
}

export interface MerchantOptions {
  fake: boolean;
  leashApi?: string;
  facilitatorUrl?: string;
  payTo?: string;
  attacker?: string;
  usdc?: string;
  /**
   * Seller-side identity check: given the agent's ENS name (X-Leash-Agent header), return its public
   * records as read from ENS. The merchant refuses agents that are not active, and refuses payments
   * from a wallet that is not one of the agent's published wallets.
   */
  lookupAgent?: (ensName: string) => Promise<{ exists: boolean; status?: string; hot?: string; vault?: string }>;
  /** Refuse requests that don't say which agent they come from. */
  requireAgent?: boolean;
}

export function buildMerchant(o: MerchantOptions) {
  const NETWORK = "hedera:testnet" as const;
  const USDC = o.usdc ?? "0.0.429274";
  const MERCHANT = o.payTo ?? "0.0.6001";
  const ATTACKER = o.attacker ?? "0.0.6666";
  const FAKE = o.fake;
  const LEASH_API = o.leashApi ?? "http://localhost:4000/v1";
  const FAKE_FEE_PAYER = "0.0.7162784";
  /** Offline facilitator: same interface as a real one, settles via Leash's fake ledger. */
  class FakeFacilitator implements FacilitatorClient {
    async getSupported(): Promise<SupportedResponse> {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK, extra: { feePayer: FAKE_FEE_PAYER } }], extensions: [], signers: { "hedera:*": [FAKE_FEE_PAYER] } };
    }
    async verify(p: PaymentPayload): Promise<VerifyResponse> {
      return { isValid: typeof (p.payload as any)?.transaction === "string" };
    }
    async settle(p: PaymentPayload): Promise<SettleResponse> {
      const res = await fetch(`${LEASH_API}/dev/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txBytesBase64: (p.payload as any).transaction }),
      });
      const body: any = await res.json();
      if (!res.ok) return { success: false, errorReason: body?.message ?? "settle failed", transaction: "", network: NETWORK };
      return { success: true, transaction: body.txId, network: NETWORK };
    }
  }

  const facilitator: FacilitatorClient = FAKE ? new FakeFacilitator() : new HTTPFacilitatorClient({ url: o.facilitatorUrl ?? "https://api.testnet.blocky402.com" });
  const server = new x402ResourceServer(facilitator).register(NETWORK, new ExactHederaScheme());

  const usdc = (amount: string) => ({ asset: USDC, amount }); // smallest units, 6 decimals
  const option = (amount: string, payTo = MERCHANT) => ({ scheme: "exact", network: NETWORK, payTo, price: usdc(amount), maxTimeoutSeconds: 120 });

  const app = express();
  // Behind Vercel / Railway proxies: build resource URLs from the public host (X-Forwarded-Host), not the internal one.
  app.set("trust proxy", true);
  // x402 builds the resource URL from the raw Host header, so put the public host there.
  app.use((req, _res, next) => {
    const pub = process.env.MERCHANT_PUBLIC_HOST || req.header("x-forwarded-host");
    if (pub) req.headers.host = pub.split(",")[0]!.trim();
    next();
  });
  app.get("/", (_req, res) => res.json({ service: "Weather Pro (demo x402 merchant)", network: NETWORK, payTo: MERCHANT, fake: FAKE }));

  // ---- seller-side ENS check (runs before the x402 middleware) -------------------------------
  const cache = new Map<string, { at: number; rec: Awaited<ReturnType<NonNullable<MerchantOptions["lookupAgent"]>>> }>();
  app.use(async (req, res, next) => {
    if (req.path === "/" || !o.lookupAgent) return next();
    const name = req.header("x-leash-agent");
    if (!name) return o.requireAgent ? void res.status(403).json({ error: "agent_required", message: "Send X-Leash-Agent with your ENS name" }) : next();
    try {
      let hit = cache.get(name);
      if (!hit || Date.now() - hit.at > 8000) {
        hit = { at: Date.now(), rec: await o.lookupAgent(name) };
        cache.set(name, hit);
      }
      const rec = hit.rec;
      if (!rec.exists || rec.status !== "active") {
        return void res.status(403).json({ error: "agent_not_active", message: `${name} is ${rec.status ?? "not registered"} on ENS`, ens: name });
      }
      // On the paid retry, the payer must be one of the wallets the agent publishes on ENS.
      const sig = req.header("payment-signature");
      if (sig) {
        const payer = payerOf(sig);
        if (payer && payer !== rec.hot && payer !== rec.vault) {
          return void res.status(403).json({ error: "payer_mismatch", message: `payment from ${payer}, but ${name} lists ${rec.hot} / ${rec.vault}` });
        }
      }
      res.setHeader("X-Leash-Agent-Verified", `${name}; status=active; source=ens`);
      next();
    } catch (e) {
      res.status(503).json({ error: "ens_unavailable", message: `could not check ${name} on ENS: ${(e as Error).message}` });
    }
  });

  app.use(
    paymentMiddleware(
      {
        "GET /forecast": { accepts: option("50000"), description: "7-day forecast", serviceName: "Weather Pro" },
        "GET /report/premium": { accepts: option("2500000"), description: "Premium 30-day climate report", serviceName: "Weather Pro" },
        "GET /invoice/*": { accepts: option("400000"), description: "Invoice payment", serviceName: "Weather Pro" },
        "GET /attacker/data": { accepts: option("20000", ATTACKER), description: "Totally legit data", serviceName: "Free Data Co" },
      },
      server,
    ),
  );

  app.get("/forecast", (_req, res) => res.json({ city: "Mumbai", days: [31, 32, 30, 29, 31, 33, 32].map((t, i) => ({ day: i + 1, tempC: t })) }));
  app.get("/report/premium", (_req, res) => res.json({ title: "Mumbai 30-day climate outlook", summary: "Warm, humid, low rain probability." }));
  app.get("/invoice/:n", (req, res) => res.json({ invoice: req.params.n, status: "paid" }));
  app.get("/attacker/data", (_req, res) => res.json({ data: "you just paid an attacker" }));
  return app;
}
