import { hashIntent, hashPolicy, Policy, worldActionFor } from "@leash/shared";
import { WorldError } from "@leash/world";
import type { Deps } from "../deps.ts";
import { now } from "../db.ts";
import { activePolicy, getAgent } from "./agents.ts";
import { PRESENCE_WINDOW, consumeNullifier, type Owner } from "./auth.ts";
import { audit, conflict, forbidden, HttpError, notFound, sha256 } from "./common.ts";
import { frozen, getIntent, releaseReservation } from "./intents.ts";

export interface ApprovalRow {
  id: string;
  intent_id: string;
  agent_id: string;
  world_action: string;
  status: string;
  warnings: string;
  nullifier: string | null;
  expires_at: number;
  decided_at: number | null;
  created_at: number;
}

function getOwnedApproval(d: Deps, owner: Owner, id: string): ApprovalRow {
  const ap = d.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as ApprovalRow | undefined;
  if (!ap || getAgent(d, ap.agent_id).owner_id !== owner.id) throw notFound("approval not found");
  return ap;
}

function view(d: Deps, ap: ApprovalRow) {
  const i = getIntent(d, ap.intent_id);
  const agent = getAgent(d, ap.agent_id);
  return {
    id: ap.id,
    status: ap.status,
    agent: { id: agent.id, ens: agent.ens_name },
    kind: i.kind,
    summary: i.summary,
    warnings: JSON.parse(ap.warnings) as string[],
    intent: frozen(i),
    /** The browser recomputes this from `intent` (with @leash/shared) and shows a ✓ if it matches. */
    intentHash: i.hash,
    worldAction: ap.world_action,
    proposedPolicy: i.payload_json ? JSON.parse(i.payload_json) : undefined,
    expiresAt: ap.expires_at,
    createdAt: ap.created_at,
    decidedAt: ap.decided_at,
  };
}

export function listApprovals(d: Deps, owner: Owner, status?: string) {
  const rows = d.db
    .prepare(
      `SELECT ap.* FROM approvals ap JOIN agents a ON a.id = ap.agent_id
        WHERE a.owner_id = ? ${status ? "AND ap.status = ?" : ""} ORDER BY ap.created_at DESC LIMIT 100`,
    )
    .all(...(status ? [owner.id, status] : [owner.id])) as ApprovalRow[];
  return rows.map((r) => view(d, r));
}

export function getApproval(d: Deps, owner: Owner, id: string) {
  return view(d, getOwnedApproval(d, owner, id));
}

function assertPending(ap: ApprovalRow) {
  if (ap.status !== "pending") throw conflict(`approval is ${ap.status}`, "not_pending");
  if (ap.expires_at <= now()) throw conflict("approval expired", "expired");
}

/** IDKit params bound to THIS approval's action, linked to the owner's World ID session. */
export async function approvalWorldRequest(d: Deps, owner: Owner, id: string) {
  const ap = getOwnedApproval(d, owner, id);
  assertPending(ap);
  const i = getIntent(d, ap.intent_id);
  return d.world.requestParams({
    action: ap.world_action,
    sessionId: owner.world_session_id,
    actionDescription: i.summary.slice(0, 200), // shown in World App; built from the frozen intent, never agent text
    ttlSeconds: Math.max(30, Math.min(300, ap.expires_at - now())),
  });
}

/**
 * The gate. An approval is accepted only if ALL hold:
 *  1. approval pending, not expired, belongs to this owner
 *  2. World verifies the proof
 *  3. proof action == this approval's action  (== hash of the frozen intent)
 *  4. proof comes from the OWNER: session_id matches, or (fallback) owner proved presence recently
 *  5. the stored intent still hashes to the same action (defence against DB tampering)
 *  6. nullifier never used before (replay)
 *  7. atomic pending -> approved (exactly once)
 */
export async function approveWithWorld(d: Deps, owner: Owner, id: string, result: unknown) {
  const ap = getOwnedApproval(d, owner, id);
  assertPending(ap);

  let proof;
  try {
    proof = await d.world.verify(result, { action: ap.world_action });
  } catch (e) {
    if (e instanceof WorldError) throw new HttpError(422, e.message, "proof_invalid");
    throw e;
  }
  if (proof.action !== ap.world_action) throw new HttpError(422, "proof is for a different action", "wrong_action");

  if (proof.sessionId) {
    if (proof.sessionId !== owner.world_session_id) throw forbidden("proof is not from this agent's owner");
  } else {
    const fresh = owner.fresh_presence_at && owner.fresh_presence_at >= now() - PRESENCE_WINDOW;
    if (!fresh) throw new HttpError(403, "owner presence required: prove your World ID session first", "owner_presence_required");
  }

  const i = getIntent(d, ap.intent_id);
  const intent = frozen(i);
  const h = hashIntent(intent);
  if (h !== i.hash || worldActionFor(intent, h) !== ap.world_action) throw new HttpError(500, "intent integrity check failed", "integrity");

  let policyApplied: { version: number; hash: string } | undefined;
  d.db.transaction(() => {
    consumeNullifier(d, proof.nullifier, ap.world_action);
    const ch = d.db
      .prepare(`UPDATE approvals SET status = 'approved', nullifier = ?, decided_at = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
      .run(proof.nullifier, now(), ap.id, now()).changes;
    if (ch !== 1) throw conflict("approval no longer pending", "not_pending");

    if (i.kind === "payment") {
      d.db.prepare(`UPDATE intents SET status = 'approved_vault' WHERE id = ? AND status = 'awaiting_approval'`).run(i.id);
    } else {
      const next = Policy.parse(JSON.parse(i.payload_json!));
      const nextHash = hashPolicy(next);
      if (intent.kind !== "policy_change" || nextHash !== intent.policyHash) throw new HttpError(500, "policy integrity check failed", "integrity");
      const cur = activePolicy(d, i.agent_id);
      d.db.prepare(`UPDATE policies SET active = 0 WHERE agent_id = ?`).run(i.agent_id);
      d.db
        .prepare(`INSERT INTO policies (agent_id, version, json, hash, active, approved_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)`)
        .run(i.agent_id, cur.version + 1, JSON.stringify(next), nextHash, ap.id, now());
      d.db.prepare(`UPDATE intents SET status = 'applied' WHERE id = ?`).run(i.id);
      policyApplied = { version: cur.version + 1, hash: nextHash };
    }
  })();

  const agent = getAgent(d, ap.agent_id);
  d.bus.emit("approval.resolved", { agentId: agent.id, approvalId: ap.id, intentId: i.id, status: "approved" }, owner.id);
  if (policyApplied) {
    d.bus.emit("policy.updated", { agentId: agent.id, ...policyApplied }, owner.id);
    void d.ens.setRecords(agent.label, { policy: policyApplied.hash }).catch((e) => console.error("[ens] policy record failed:", e?.message ?? e));
  }
  void audit(d, owner.id, {
    type: policyApplied ? "POLICY_APPLIED" : "APPROVAL_APPROVED",
    agentId: agent.id,
    // nullifier hash, not the nullifier: links receipt <-> log without publishing the raw value
    fields: { approval: ap.id, action: ap.world_action, nh: sha256(proof.nullifier).slice(0, 32), ...(policyApplied ? { policy: policyApplied.hash } : {}) },
  });
  return view(d, getOwnedApproval(d, owner, id));
}

export function denyApproval(d: Deps, owner: Owner, id: string) {
  const ap = getOwnedApproval(d, owner, id);
  if (ap.status !== "pending") throw conflict(`approval is ${ap.status}`, "not_pending");
  const i = getIntent(d, ap.intent_id);
  d.db.transaction(() => {
    d.db.prepare(`UPDATE approvals SET status = 'denied', decided_at = ? WHERE id = ? AND status = 'pending'`).run(now(), ap.id);
    d.db.prepare(`UPDATE intents SET status = 'denied' WHERE id = ?`).run(i.id);
    if (i.kind === "payment") {
      const p = frozen(i);
      const cooldown = activePolicy(d, ap.agent_id).policy.denyCooldownSeconds;
      if (p.kind === "payment" && cooldown > 0) {
        d.db
          .prepare(
            `INSERT INTO payees (agent_id, account, first_seen, cooldown_until) VALUES (?, ?, ?, ?)
             ON CONFLICT(agent_id, account) DO UPDATE SET cooldown_until = excluded.cooldown_until`,
          )
          .run(ap.agent_id, p.payTo, now(), now() + cooldown);
      }
    }
  })();
  d.bus.emit("approval.resolved", { agentId: ap.agent_id, approvalId: ap.id, intentId: i.id, status: "denied" }, owner.id);
  void audit(d, owner.id, { type: "APPROVAL_DENIED", agentId: ap.agent_id, fields: { approval: ap.id, action: ap.world_action } });
  return view(d, getOwnedApproval(d, owner, id));
}

/** Cron: expire pending approvals and stale authorisations. Returns how many changed. */
export function expireSweep(d: Deps): number {
  const t = now();
  let n = 0;
  const pend = d.db.prepare(`SELECT * FROM approvals WHERE status = 'pending' AND expires_at <= ?`).all(t) as ApprovalRow[];
  for (const ap of pend) {
    const ch = d.db.prepare(`UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'`).run(t, ap.id).changes;
    if (!ch) continue;
    d.db.prepare(`UPDATE intents SET status = 'expired' WHERE id = ?`).run(ap.intent_id);
    const owner = getAgent(d, ap.agent_id).owner_id;
    d.bus.emit("approval.resolved", { agentId: ap.agent_id, approvalId: ap.id, intentId: ap.intent_id, status: "expired" }, owner);
    void audit(d, owner, { type: "APPROVAL_EXPIRED", agentId: ap.agent_id, fields: { approval: ap.id } });
    n++;
  }
  const stale = d.db.prepare(`SELECT * FROM intents WHERE status IN ('authorized_hot','approved_vault') AND expires_at <= ?`).all(t) as any[];
  for (const i of stale) {
    d.db.prepare(`UPDATE intents SET status = 'expired' WHERE id = ?`).run(i.id);
    releaseReservation(d, i);
    n++;
  }
  return n;
}
