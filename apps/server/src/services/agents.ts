import { PrivateKey } from "@leash/hedera";
import { defaultPolicy, hashPolicy, Policy, type AgentStatus, type CreateAgentReq } from "@leash/shared";
import type { Deps } from "../deps.ts";
import { now } from "../db.ts";
import { audit, bad, conflict, forbidden, newId, notFound, randomToken, sha256 } from "./common.ts";
import type { Owner } from "./auth.ts";

export interface AgentRow {
  id: string;
  owner_id: string;
  label: string;
  ens_name: string;
  hot_account: string;
  vault_account: string;
  agent_public_key: string;
  status: AgentStatus;
  api_key_hash: string;
  last_watch_ts: string;
  created_at: number;
}

const AGENT_TTL = 90 * 24 * 3600; // ENS subname expiry for new agents

export function getAgent(d: Deps, id: string): AgentRow {
  const a = d.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined;
  if (!a) throw notFound("agent not found");
  return a;
}
export function getOwnedAgent(d: Deps, owner: Owner, id: string): AgentRow {
  const a = getAgent(d, id);
  if (a.owner_id !== owner.id) throw notFound("agent not found");
  return a;
}
export function agentFromApiKey(d: Deps, key: string | undefined): AgentRow | null {
  if (!key) return null;
  return (d.db.prepare(`SELECT * FROM agents WHERE api_key_hash = ?`).get(sha256(key)) as AgentRow | undefined) ?? null;
}

export function activePolicy(d: Deps, agentId: string): { policy: Policy; version: number; hash: string } {
  const row = d.db.prepare(`SELECT json, version, hash FROM policies WHERE agent_id = ? AND active = 1`).get(agentId) as
    | { json: string; version: number; hash: string }
    | undefined;
  if (!row) throw new Error(`no active policy for ${agentId}`);
  return { policy: Policy.parse(JSON.parse(row.json)), version: row.version, hash: row.hash };
}

export async function createAgent(d: Deps, owner: Owner, req: CreateAgentReq) {
  if (d.db.prepare(`SELECT 1 FROM agents WHERE label = ?`).get(req.name)) throw conflict("agent name taken", "name_taken");

  // Agent key: generated here, returned ONCE, never stored (only its public key).
  const agentKey = PrivateKey.generateECDSA();
  // Owner recovery key: should come from the browser. Dev convenience: generate and return once.
  let recoveryPrivate: string | undefined;
  let recoveryPublic = req.ownerRecoveryPublicKey;
  if (!recoveryPublic) {
    const k = PrivateKey.generateECDSA();
    recoveryPrivate = k.toStringDer();
    recoveryPublic = k.publicKey.toStringDer();
  }

  const policy = Policy.parse(req.policy ?? defaultPolicy());
  const policyHash = hashPolicy(policy);
  const accounts = await d.ledger.createAgentAccounts({ agentPublicKey: agentKey.publicKey.toStringDer(), ownerRecoveryPublicKey: recoveryPublic });

  const id = newId("agt");
  const apiKey = randomToken("lsh");
  const ensName = d.ens.fullName(req.name);

  d.db.transaction(() => {
    d.db
      .prepare(
        `INSERT INTO agents (id, owner_id, label, ens_name, hot_account, vault_account, agent_public_key, api_key_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, owner.id, req.name, ensName, accounts.hot, accounts.vault, agentKey.publicKey.toStringDer(), sha256(apiKey), now());
    d.db
      .prepare(`INSERT INTO policies (agent_id, version, json, hash, active, created_at) VALUES (?, 1, ?, ?, 1, ?)`)
      .run(id, JSON.stringify(policy), policyHash, now());
  })();

  // ENS identity (best effort: the agent works even if ENS is slow; the owner can retry).
  let ensError: string | undefined;
  await d.ens
    .registerAgent(
      req.name,
      { status: "active", policy: policyHash, hot: accounts.hot, vault: accounts.vault, audit: d.audit.topicId, owner: owner.id },
      now() + AGENT_TTL,
    )
    .catch((e) => {
      ensError = String(e?.message ?? e);
      console.error("[ens] register failed:", ensError);
    });

  // Fake mode: pre-fund so the whole flow is clickable offline.
  if (d.ledger.mode === "fake") {
    const fl = d.ledger as any;
    fl.devFund(accounts.hot, d.cfg.HEDERA_USDC_TOKEN_ID, "500000"); // 0.50 USDC
    fl.devFund(accounts.vault, d.cfg.HEDERA_USDC_TOKEN_ID, "20000000"); // 20 USDC
  }

  void audit(d, owner.id, {
    type: "AGENT_CREATED",
    agentId: id,
    fields: { ens: ensName, hot: accounts.hot, vault: accounts.vault, policy: policyHash },
  });

  return {
    agent: publicAgent(getAgent(d, id)),
    secrets: {
      note: "Shown once. Put agentPrivateKey + apiKey in the agent's env; keep the recovery key offline.",
      apiKey,
      agentPrivateKey: agentKey.toStringDer(),
      ownerRecoveryPrivateKey: recoveryPrivate,
    },
    ensError,
  };
}

export function publicAgent(a: AgentRow) {
  const { api_key_hash: _h, last_watch_ts: _w, ...rest } = a;
  return rest;
}

export async function agentDetail(d: Deps, a: AgentRow) {
  const [hot, vault] = await Promise.all([d.ledger.getBalances(a.hot_account), d.ledger.getBalances(a.vault_account)]);
  const pol = activePolicy(d, a.id);
  return {
    agent: publicAgent(a),
    balances: { hot, vault },
    policy: pol,
    links: { ens: d.ens.explorerUrl(a.ens_name), audit: d.audit.topicUrl() },
    modes: { world: d.world.mode, hedera: d.ledger.mode, ens: d.ens.mode },
  };
}

export async function emitBalances(d: Deps, a: AgentRow) {
  const [hot, vault] = await Promise.all([d.ledger.getBalances(a.hot_account), d.ledger.getBalances(a.vault_account)]);
  d.bus.emit("balance.updated", { agentId: a.id, hot, vault }, a.owner_id);
}

export async function setStatus(d: Deps, owner: Owner, a: AgentRow, status: AgentStatus) {
  if (a.status === "revoked") throw bad("agent is revoked");
  if (a.owner_id !== owner.id) throw forbidden();
  d.db.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run(status, a.id);
  if (status !== "active") {
    // Close everything in flight: pending approvals can no longer lead to a co-signature.
    const pend = d.db.prepare(`SELECT id, intent_id FROM approvals WHERE agent_id = ? AND status = 'pending'`).all(a.id) as { id: string; intent_id: string }[];
    for (const p of pend) {
      d.db.prepare(`UPDATE approvals SET status = 'cancelled', decided_at = ? WHERE id = ?`).run(now(), p.id);
      d.db.prepare(`UPDATE intents SET status = 'cancelled' WHERE id = ?`).run(p.intent_id);
      d.bus.emit("approval.resolved", { agentId: a.id, approvalId: p.id, intentId: p.intent_id, status: "cancelled" }, owner.id);
    }
    d.db.prepare(`UPDATE intents SET status = 'cancelled' WHERE agent_id = ? AND status IN ('authorized_hot','approved_vault')`).run(a.id);
  }
  if (status === "revoked") {
    d.db.prepare(`UPDATE agents SET api_key_hash = ? WHERE id = ?`).run(sha256(randomToken("revoked")), a.id);
    await d.ens.revoke(a.label).catch((e) => console.error("[ens] revoke failed:", e?.message ?? e));
  } else {
    await d.ens.setRecords(a.label, { status }).catch((e) => console.error("[ens] status update failed:", e?.message ?? e));
  }
  d.bus.emit("agent.status", { agentId: a.id, status }, owner.id);
  void audit(d, owner.id, { type: `AGENT_${status.toUpperCase()}`, agentId: a.id, fields: {} });
  return publicAgent(getAgent(d, a.id));
}

export function activity(d: Deps, agentId: string, limit = 50, before?: number) {
  const rows = d.db
    .prepare(
      `SELECT i.id, i.kind, i.decision, i.reasons, i.status, i.summary, i.created_at, i.expires_at, i.hash,
              a.id AS approval_id, a.status AS approval_status,
              p.tx_id, p.source
         FROM intents i
         LEFT JOIN approvals a ON a.intent_id = i.id
         LEFT JOIN payments p ON p.intent_id = i.id
        WHERE i.agent_id = ? AND i.created_at < ?
        ORDER BY i.created_at DESC, i.rowid DESC LIMIT ?`,
    )
    .all(agentId, before ?? Number.MAX_SAFE_INTEGER, limit) as any[];
  return rows.map((r) => ({ ...r, reasons: JSON.parse(r.reasons), explorerUrl: r.tx_id ? d.ledger.explorerTxUrl(r.tx_id) : null }));
}

export function auditLog(d: Deps, agentId: string) {
  return (d.db.prepare(`SELECT * FROM audit_events WHERE agent_id = ? ORDER BY id DESC LIMIT 500`).all(agentId) as any[]).map((r) => ({
    ...r,
    fields: JSON.parse(r.fields_json),
    fields_json: undefined,
    payload_json: undefined,
  }));
}

export function auditCsv(d: Deps, agentId: string): string {
  const rows = auditLog(d, agentId);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["time_utc", "type", "hcs_topic", "hcs_seq", "payload_hash", "fields"].join(",");
  return [
    head,
    ...rows.map((r) => [new Date(r.created_at * 1000).toISOString(), r.type, r.topic_id, r.seq, r.payload_hash, JSON.stringify(r.fields)].map(esc).join(",")),
  ].join("\n");
}
