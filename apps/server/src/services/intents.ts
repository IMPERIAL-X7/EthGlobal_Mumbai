import { randomBytes } from "node:crypto";
import { evaluate } from "@leash/policy";
import { CosignRejected, cosignVaultTransfer } from "@leash/hedera";
import {
  describeAmount,
  hashIntent,
  hashPolicy,
  Policy,
  worldActionFor,
  type Intent,
  type PaymentIntent,
  type PolicyChangeIntent,
  type SubmitPaymentReq,
} from "@leash/shared";
import type { Deps } from "../deps.ts";
import { now, utcDay } from "../db.ts";
import { activePolicy, emitBalances, getAgent, type AgentRow } from "./agents.ts";
import { audit, bad, conflict, HttpError, newId, notFound } from "./common.ts";

/**
 * Intent status machine
 *   payment:  authorized_hot -> settled | failed | cancelled | expired
 *             awaiting_approval -> approved_vault -> cosigned -> settled | failed
 *             awaiting_approval -> denied | expired | cancelled
 *             denied (policy DENY)
 *   policy_change: awaiting_approval -> applied | denied | expired | cancelled
 */
export interface IntentRow {
  id: string;
  agent_id: string;
  kind: "payment" | "policy_change";
  canonical_json: string;
  hash: string;
  decision: string;
  reasons: string;
  status: string;
  fee_payer: string | null;
  reserved_auto: string;
  payload_json: string | null;
  summary: string;
  /** The agent's own words (untrusted). Dashboard only, never World App. */
  agent_reason: string | null;
  created_at: number;
  expires_at: number;
}

export function getIntent(d: Deps, id: string): IntentRow {
  const i = d.db.prepare(`SELECT * FROM intents WHERE id = ?`).get(id) as IntentRow | undefined;
  if (!i) throw notFound("intent not found");
  return i;
}
function getAgentIntent(d: Deps, agent: AgentRow, id: string): IntentRow {
  const i = getIntent(d, id);
  if (i.agent_id !== agent.id) throw notFound("intent not found");
  return i;
}
export const frozen = (i: IntentRow) => JSON.parse(i.canonical_json) as Intent;

function payeeLabel(d: Deps, agentId: string, account: string) {
  const r = d.db.prepare(`SELECT label FROM payees WHERE agent_id = ? AND account = ?`).get(agentId, account) as { label: string | null } | undefined;
  return r?.label ?? undefined;
}

/**
 * The summary is what World App shows the human at the moment of approval, so it is built ONLY
 * from frozen facts. The resource is reduced to its host: the path is chosen by the agent and could
 * carry text aimed at the human ("/approved-by-owner-safe-to-confirm"). Full URL stays in `intent`.
 */
export function summarizePayment(i: PaymentIntent, label?: string): string {
  let host = i.resource.slice(0, 60);
  try {
    host = new URL(i.resource).host;
  } catch {}
  return `Pay ${describeAmount(i.amount, i.asset)} to ${label ? `${label} (${i.payTo})` : i.payTo} for ${host}`;
}

/** Release an AUTO_HOT daily-budget reservation (on cancel / fail / expiry). */
export function releaseReservation(d: Deps, i: IntentRow) {
  if (i.reserved_auto === "0") return;
  const p = frozen(i) as PaymentIntent;
  const day = utcDay(i.created_at * 1000);
  const row = d.db.prepare(`SELECT auto_spent FROM spend_counters WHERE agent_id = ? AND day = ? AND asset = ?`).get(i.agent_id, day, p.asset) as
    | { auto_spent: string }
    | undefined;
  if (row) {
    const next = BigInt(row.auto_spent) - BigInt(i.reserved_auto);
    d.db.prepare(`UPDATE spend_counters SET auto_spent = ? WHERE agent_id = ? AND day = ? AND asset = ?`).run((next < 0n ? 0n : next).toString(), i.agent_id, day, p.asset);
  }
  d.db.prepare(`UPDATE intents SET reserved_auto = '0' WHERE id = ?`).run(i.id);
}

// ------------------------------------------------------------------ submit

export async function submitPayment(d: Deps, agent: AgentRow, req: SubmitPaymentReq) {
  const { policy } = activePolicy(d, agent.id);
  const t = now();
  const intent: PaymentIntent = {
    v: 1,
    kind: "payment",
    agentId: agent.id,
    nonce: randomBytes(12).toString("hex"),
    createdAt: t,
    expiresAt: t + policy.approvalTtlSeconds,
    network: req.network,
    asset: req.asset,
    payTo: req.payTo,
    amount: req.amount,
    resource: req.resource,
    description: req.description,
  };
  const hash = hashIntent(intent);
  const action = worldActionFor(intent, hash);
  const label = payeeLabel(d, agent.id, req.payTo);
  const summary = summarizePayment(intent, label);

  // Only async step: balance. Everything after runs inside one synchronous SQLite transaction,
  // so concurrent requests cannot both squeeze under the daily budget.
  const hotBalance = (await d.ledger.getBalances(agent.hot_account))[req.asset] ?? "0";

  const result = d.db.transaction(() => {
    const fresh = getAgent(d, agent.id);
    const day = utcDay();
    const spent = (d.db.prepare(`SELECT auto_spent FROM spend_counters WHERE agent_id = ? AND day = ? AND asset = ?`).get(agent.id, day, req.asset) as
      | { auto_spent: string }
      | undefined)?.auto_spent ?? "0";
    const payee = d.db.prepare(`SELECT count, cooldown_until FROM payees WHERE agent_id = ? AND account = ?`).get(agent.id, req.payTo) as
      | { count: number; cooldown_until: number | null }
      | undefined;
    const pending = (d.db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE agent_id = ? AND status = 'pending'`).get(agent.id) as { n: number }).n;

    const decision = evaluate(intent, policy, {
      agentStatus: fresh.status,
      autoSpentToday: spent,
      hotBalance,
      knownPayee: (payee?.count ?? 0) > 0,
      pendingApprovals: pending,
      payeeCooldownUntil: payee?.cooldown_until ?? undefined,
      now: t,
    });

    const id = newId("int");
    const status = decision.kind === "AUTO_HOT" ? "authorized_hot" : decision.kind === "NEEDS_APPROVAL" ? "awaiting_approval" : "denied";
    const reserved = decision.kind === "AUTO_HOT" ? req.amount : "0";
    d.db
      .prepare(
        `INSERT INTO intents (id, agent_id, kind, canonical_json, hash, decision, reasons, status, fee_payer, reserved_auto, summary, created_at, expires_at)
         VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, agent.id, JSON.stringify(intent), hash, decision.kind, JSON.stringify(decision.reasons), status, req.feePayer ?? null, reserved, summary, t, intent.expiresAt);

    if (decision.kind === "AUTO_HOT") {
      d.db
        .prepare(
          `INSERT INTO spend_counters (agent_id, day, asset, auto_spent) VALUES (?, ?, ?, ?)
           ON CONFLICT(agent_id, day, asset) DO UPDATE SET auto_spent = CAST(CAST(auto_spent AS INTEGER) + CAST(excluded.auto_spent AS INTEGER) AS TEXT)`,
        )
        .run(agent.id, day, req.asset, req.amount);
    }
    let approvalId: string | undefined;
    if (decision.kind === "NEEDS_APPROVAL") {
      approvalId = newId("apr");
      d.db
        .prepare(`INSERT INTO approvals (id, intent_id, agent_id, world_action, status, warnings, expires_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(approvalId, id, agent.id, action, JSON.stringify(decision.warnings), intent.expiresAt, t);
    }
    return { id, decision, approvalId };
  })();

  d.bus.emit("intent.created", { agentId: agent.id, intentId: result.id, kind: "payment", decision: result.decision.kind, reasons: result.decision.reasons, summary }, agent.owner_id);
  if (result.approvalId) {
    d.bus.emit(
      "approval.pending",
      { agentId: agent.id, approvalId: result.approvalId, intentId: result.id, summary, intentHash: hash, worldAction: action, warnings: result.decision.warnings, expiresAt: intent.expiresAt },
      agent.owner_id,
    );
  }
  void audit(d, agent.owner_id, {
    type: "INTENT_DECIDED",
    agentId: agent.id,
    fields: { intent: result.id, decision: result.decision.kind, amount: req.amount, asset: req.asset, payTo: req.payTo, h: hash.slice(0, 32) },
    payload: intent,
  });

  const base = { intentId: result.id, intentHash: hash, reasons: result.decision.reasons, warnings: result.decision.warnings, expiresAt: intent.expiresAt };
  if (result.decision.kind === "AUTO_HOT") return { ...base, decision: "auto" as const, payFrom: agent.hot_account };
  if (result.decision.kind === "NEEDS_APPROVAL") return { ...base, decision: "pending" as const, approvalId: result.approvalId!, payFrom: agent.vault_account };
  return { ...base, decision: "denied" as const };
}

/** Owner or agent proposes a new policy. Never applied without a World ID approval. */
export function proposePolicy(d: Deps, agent: AgentRow, newPolicy: Policy, by: "owner" | "agent", reason?: string) {
  const parsed = Policy.parse(newPolicy);
  const cur = activePolicy(d, agent.id);
  const policyHash = hashPolicy(parsed);
  if (policyHash === cur.hash) throw bad("policy unchanged");
  if (agent.status === "revoked") throw bad("agent is revoked");

  const t = now();
  const intent: PolicyChangeIntent = { v: 1, kind: "policy_change", agentId: agent.id, nonce: randomBytes(12).toString("hex"), createdAt: t, expiresAt: t + cur.policy.approvalTtlSeconds, policyHash };
  const hash = hashIntent(intent);
  const action = worldActionFor(intent, hash);
  // Facts only: the agent's reason never goes into the summary (World App shows the summary).
  const summary = `${by === "agent" ? "Agent requests" : "Change"} spending limits: ${diffPolicy(cur.policy, parsed)}`;
  const agentReason = by === "agent" && reason ? reason.slice(0, 280) : null;
  const warnings = by === "agent" ? ["Requested by the agent itself, not by you"] : [];

  const id = newId("int");
  const approvalId = newId("apr");
  d.db.transaction(() => {
    const pending = (d.db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE agent_id = ? AND status = 'pending'`).get(agent.id) as { n: number }).n;
    if (pending >= cur.policy.maxPendingApprovals) throw conflict("too many pending approvals", "too_many_pending");
    d.db
      .prepare(
        `INSERT INTO intents (id, agent_id, kind, canonical_json, hash, decision, reasons, status, payload_json, summary, agent_reason, created_at, expires_at)
         VALUES (?, ?, 'policy_change', ?, ?, 'NEEDS_APPROVAL', ?, 'awaiting_approval', ?, ?, ?, ?, ?)`,
      )
      .run(id, agent.id, JSON.stringify(intent), hash, JSON.stringify([`policy change by ${by}`]), JSON.stringify(parsed), summary, agentReason, t, intent.expiresAt);
    d.db
      .prepare(`INSERT INTO approvals (id, intent_id, agent_id, world_action, status, warnings, expires_at, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(approvalId, id, agent.id, action, JSON.stringify(warnings), intent.expiresAt, t);
  })();

  d.bus.emit("intent.created", { agentId: agent.id, intentId: id, kind: "policy_change", decision: "NEEDS_APPROVAL", reasons: [`policy change by ${by}`], summary }, agent.owner_id);
  d.bus.emit("approval.pending", { agentId: agent.id, approvalId, intentId: id, summary, agentReason, intentHash: hash, worldAction: action, warnings, expiresAt: intent.expiresAt }, agent.owner_id);
  void audit(d, agent.owner_id, { type: "POLICY_PROPOSED", agentId: agent.id, fields: { by, policy: policyHash, h: hash.slice(0, 32) }, payload: parsed });
  return { intentId: id, approvalId, intentHash: hash, expiresAt: intent.expiresAt, summary };
}

function diffPolicy(a: Policy, b: Policy): string {
  const parts: string[] = [];
  const usdc = (v: string) => describeAmount(v, "0.0.429274");
  if (a.autoPerPayment !== b.autoPerPayment) parts.push(`auto per payment ${usdc(a.autoPerPayment)} → ${usdc(b.autoPerPayment)}`);
  if (a.autoDaily !== b.autoDaily) parts.push(`daily auto ${usdc(a.autoDaily)} → ${usdc(b.autoDaily)}`);
  if (a.hardMaxPerPayment !== b.hardMaxPerPayment) parts.push(`hard max ${usdc(a.hardMaxPerPayment)} → ${usdc(b.hardMaxPerPayment)}`);
  if (a.requireApprovalForNewPayee !== b.requireApprovalForNewPayee) parts.push(`approval for new payees ${b.requireApprovalForNewPayee ? "ON" : "OFF"}`);
  if (a.allowlist.join() !== b.allowlist.join()) parts.push(`allowlist (${b.allowlist.length} entries)`);
  if (a.blocklist.join() !== b.blocklist.join()) parts.push(`blocklist (${b.blocklist.length} entries)`);
  if (a.approvalTtlSeconds !== b.approvalTtlSeconds || a.maxPendingApprovals !== b.maxPendingApprovals || a.denyCooldownSeconds !== b.denyCooldownSeconds) parts.push("approval settings");
  if (a.allowedAssets.join() !== b.allowedAssets.join()) parts.push("allowed assets");
  return parts.join("; ") || "minor changes";
}

// ------------------------------------------------------------------ agent follow-ups

export async function waitForDecision(d: Deps, agent: AgentRow, intentId: string, timeoutSec: number) {
  const i = getAgentIntent(d, agent, intentId);
  if (i.status === "awaiting_approval") {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, Math.min(Math.max(timeoutSec, 1), 55) * 1000);
      const off = d.bus.on("approval.resolved", (e) => e.intentId === intentId && done());
      function done() {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  }
  const cur = getIntent(d, intentId);
  const ap = d.db.prepare(`SELECT id, status FROM approvals WHERE intent_id = ?`).get(intentId) as { id: string; status: string } | undefined;
  return { intentId, status: cur.status, approval: ap ?? null, expiresAt: cur.expires_at };
}

export async function cosign(d: Deps, agent: AgentRow, intentId: string, txBytesBase64: string) {
  const i = getAgentIntent(d, agent, intentId);
  if (i.kind !== "payment") throw bad("not a payment intent");
  if (i.status !== "approved_vault") throw conflict(`intent is ${i.status}, not approved`, "not_approved");
  if (i.expires_at < now()) throw conflict("intent expired", "expired");
  if (getAgent(d, agent.id).status !== "active") throw conflict("agent not active", "agent_inactive");

  const p = frozen(i) as PaymentIntent;
  let signed: Uint8Array;
  try {
    signed = await cosignVaultTransfer(
      Buffer.from(txBytesBase64, "base64"),
      { vault: agent.vault_account, payTo: p.payTo, asset: p.asset, amount: p.amount, feePayer: i.fee_payer ?? undefined, intentExpiresAt: i.expires_at },
      d.serverKey,
    );
  } catch (e) {
    if (e instanceof CosignRejected) {
      void audit(d, agent.owner_id, { type: "COSIGN_REJECTED", agentId: agent.id, fields: { intent: i.id, why: e.message.slice(0, 200) } });
      throw new HttpError(422, `co-sign refused: ${e.message}`, "cosign_rejected");
    }
    throw e;
  }
  // Single use: only one caller can flip approved_vault -> cosigned.
  const ch = d.db.prepare(`UPDATE intents SET status = 'cosigned' WHERE id = ? AND status = 'approved_vault'`).run(i.id).changes;
  if (ch !== 1) throw conflict("already co-signed", "already_cosigned");
  void audit(d, agent.owner_id, { type: "VAULT_COSIGNED", agentId: agent.id, fields: { intent: i.id, h: i.hash.slice(0, 32) } });
  return { txBytesBase64: Buffer.from(signed).toString("base64") };
}

export async function reportSettled(d: Deps, agent: AgentRow, intentId: string, txId: string, source: "hot" | "vault") {
  const i = getAgentIntent(d, agent, intentId);
  if (i.kind !== "payment") throw bad("not a payment intent");
  const expected = source === "hot" ? "authorized_hot" : "cosigned";
  if (i.status !== expected) throw conflict(`intent is ${i.status}; cannot settle from ${source}`, "bad_state");
  if (d.db.prepare(`SELECT 1 FROM payments WHERE tx_id = ?`).get(txId)) throw conflict("transaction already used for another payment", "tx_reused");

  const p = frozen(i) as PaymentIntent;
  const from = source === "hot" ? agent.hot_account : agent.vault_account;
  const conf = await d.ledger.confirmTransfer(txId, { from, to: p.payTo, asset: p.asset, amount: p.amount });
  const tooOld = conf.ok && conf.consensusAt && Number(conf.consensusAt) < i.created_at - 5;
  if (!conf.ok || tooOld) {
    const error = tooOld ? "transaction predates the intent" : conf.error ?? "not confirmed";
    d.db.prepare(`UPDATE intents SET status = 'failed' WHERE id = ?`).run(i.id);
    releaseReservation(d, i);
    d.bus.emit("payment.failed", { agentId: agent.id, intentId: i.id, error }, agent.owner_id);
    void audit(d, agent.owner_id, { type: "PAYMENT_UNCONFIRMED", agentId: agent.id, fields: { intent: i.id, tx: txId, error: error.slice(0, 200) } });
    throw new HttpError(422, `payment not confirmed: ${error}`, "unconfirmed");
  }

  const ap = d.db.prepare(`SELECT id, world_action, nullifier, decided_at FROM approvals WHERE intent_id = ?`).get(i.id) as any;
  const paymentId = newId("pay");
  const receipt = {
    v: 1,
    paymentId,
    agent: { id: agent.id, ens: agent.ens_name, hot: agent.hot_account, vault: agent.vault_account },
    intent: p,
    intentHash: i.hash,
    source,
    approval: ap ? { id: ap.id, worldAction: ap.world_action, nullifier: ap.nullifier, approvedAt: ap.decided_at } : null,
    settlement: { txId, consensusAt: conf.consensusAt, explorerUrl: d.ledger.explorerTxUrl(txId) },
    audit: { topicId: d.audit.topicId },
  };

  d.db.transaction(() => {
    d.db.prepare(`UPDATE intents SET status = 'settled' WHERE id = ?`).run(i.id);
    d.db.prepare(`INSERT INTO payments (id, intent_id, agent_id, source, tx_id, consensus_at, receipt_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      paymentId,
      i.id,
      agent.id,
      source,
      txId,
      conf.consensusAt ?? null,
      JSON.stringify(receipt),
      now(),
    );
    d.db
      .prepare(
        `INSERT INTO payees (agent_id, account, first_seen, total_paid, count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(agent_id, account) DO UPDATE SET count = count + 1, total_paid = CAST(CAST(total_paid AS INTEGER) + CAST(excluded.total_paid AS INTEGER) AS TEXT)`,
      )
      .run(agent.id, p.payTo, now(), p.amount);
  })();

  d.bus.emit(
    "payment.settled",
    { agentId: agent.id, paymentId, intentId: i.id, txId, explorerUrl: d.ledger.explorerTxUrl(txId), amount: p.amount, asset: p.asset, payTo: p.payTo, source },
    agent.owner_id,
  );
  void audit(d, agent.owner_id, {
    type: "PAYMENT_SETTLED",
    agentId: agent.id,
    fields: { intent: i.id, tx: txId, src: source, amount: p.amount, payTo: p.payTo, h: i.hash.slice(0, 32) },
    payload: receipt,
  });
  void emitBalances(d, agent).catch(() => {});
  return { paymentId, receiptUrl: `${d.cfg.PUBLIC_BASE_URL}/v1/receipts/${paymentId}` };
}

export function cancelIntent(d: Deps, agent: AgentRow, intentId: string) {
  const i = getAgentIntent(d, agent, intentId);
  if (!["awaiting_approval", "authorized_hot", "approved_vault"].includes(i.status)) throw conflict(`cannot cancel: ${i.status}`, "bad_state");
  d.db.transaction(() => {
    d.db.prepare(`UPDATE intents SET status = 'cancelled' WHERE id = ?`).run(i.id);
    d.db.prepare(`UPDATE approvals SET status = 'cancelled', decided_at = ? WHERE intent_id = ? AND status IN ('pending','approved')`).run(now(), i.id);
    releaseReservation(d, i);
  })();
  const ap = d.db.prepare(`SELECT id FROM approvals WHERE intent_id = ?`).get(i.id) as { id: string } | undefined;
  if (ap) d.bus.emit("approval.resolved", { agentId: agent.id, approvalId: ap.id, intentId: i.id, status: "cancelled" }, agent.owner_id);
  void audit(d, agent.owner_id, { type: "INTENT_CANCELLED", agentId: agent.id, fields: { intent: i.id } });
  return { intentId: i.id, status: "cancelled" };
}
