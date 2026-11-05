import type { Deps } from "./deps.ts";
import { now } from "./db.ts";
import { expireSweep } from "./services/approvals.ts";
import { audit } from "./services/common.ts";
import type { AgentRow } from "./services/agents.ts";

/** Hot-wallet transfers must be reported within this window or they count as a bypass. */
const REPORT_GRACE_SEC = 60;

/**
 * Bypass detector. The hot wallet is the agent's own key, so it CAN pay without asking Leash —
 * the loss is bounded by its balance. We still catch it: any outgoing transfer not matched to a
 * reported payment within the grace window => ANOMALY + auto-pause.
 */
export async function watchHotWallets(d: Deps): Promise<number> {
  const agents = d.db.prepare(`SELECT * FROM agents WHERE status = 'active'`).all() as AgentRow[];
  let flagged = 0;
  for (const a of agents) {
    let transfers;
    try {
      transfers = await d.ledger.outgoingTransfers(a.hot_account, a.last_watch_ts);
    } catch (e) {
      console.error(`[watch] ${a.id}:`, (e as Error).message);
      continue;
    }
    const cutoff = now() - REPORT_GRACE_SEC;
    let watermark = a.last_watch_ts;
    for (const t of transfers) {
      if (Number(t.consensusAt) > cutoff) break; // too recent, the agent may still report it
      watermark = t.consensusAt;
      const known = d.db.prepare(`SELECT 1 FROM payments WHERE tx_id = ?`).get(t.txId);
      if (known) continue;
      flagged++;
      d.db.prepare(`UPDATE agents SET status = 'paused' WHERE id = ? AND status = 'active'`).run(a.id);
      const detail = `unreported hot-wallet payment ${t.amount} of ${t.asset} to ${t.to} (tx ${t.txId})`;
      d.bus.emit("anomaly.detected", { agentId: a.id, kind: "unreported_spend", detail }, a.owner_id);
      d.bus.emit("agent.status", { agentId: a.id, status: "paused" }, a.owner_id);
      void audit(d, a.owner_id, { type: "ANOMALY", agentId: a.id, fields: { kind: "unreported_spend", tx: t.txId, to: t.to, amount: t.amount } });
      void d.ens.setRecords(a.label, { status: "paused" }).catch(() => {});
    }
    if (watermark !== a.last_watch_ts) d.db.prepare(`UPDATE agents SET last_watch_ts = ? WHERE id = ?`).run(watermark, a.id);
  }
  return flagged;
}

export function startJobs(d: Deps) {
  const timers = [
    setInterval(() => {
      try {
        expireSweep(d);
      } catch (e) {
        console.error("[jobs] expire:", e);
      }
    }, 5_000),
    setInterval(() => void watchHotWallets(d).catch((e) => console.error("[jobs] watch:", e)), 20_000),
  ];
  return () => timers.forEach(clearInterval);
}
