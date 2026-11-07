import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { ago, assetName, fmt, mainAsset } from "../lib/format";

/** Design 7A (trimmed): dark summary header, then Activity | Audit tabs with Limits + Connection cards beside. */
type Detail = {
  agent: { id: string; label: string; ens_name: string; status: "active" | "paused" | "revoked"; hot_account: string; vault_account: string };
  balances: { hot: Record<string, string>; vault: Record<string, string> };
  spentToday: Record<string, string>;
  policy: { version: number; policy: { autoPerPayment: string; autoDaily: string; hardMaxPerPayment: string; requireApprovalForNewPayee: boolean } };
  links: { ens: string; audit: string };
};
type Row = {
  id: string; kind: "payment" | "policy_change"; decision: string; status: string; summary: string; agent_reason?: string;
  created_at: number; approval_id?: string; approval_status?: string; explorerUrl?: string | null; source?: string;
  amount?: string; asset?: string; payTo?: string; resource?: string; reasons: string[];
};

export function AgentPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [audit, setAudit] = useState<{ topicUrl: string; events: any[] } | null>(null);
  const [tab, setTab] = useState<"activity" | "audit">("activity");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => {
      api<Detail>("GET", `/agents/${id}`).then(setD).catch(() => nav("/app"));
      api<Row[]>("GET", `/agents/${id}/activity?limit=40`).then(setRows).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [id, nav]);

  useEffect(() => {
    if (tab === "audit") api("GET", `/agents/${id}/audit`).then(setAudit).catch(() => {});
  }, [tab, id]);

  const setStatus = async (action: "pause" | "resume" | "revoke") => {
    if (action === "revoke" && !confirm("Revoke this agent for good? Its key stops working and its ENS name will say revoked.")) return;
    setBusy(true);
    await api("POST", `/agents/${id}/${action}`).catch((e) => alert(e.message));
    setBusy(false);
    api<Detail>("GET", `/agents/${id}`).then(setD).catch(() => {});
  };

  if (!d) return <AppShell><p className="muted">Loading…</p></AppShell>;
  const a = mainAsset({ ...d.balances.hot, ...d.balances.vault });
  const p = d.policy.policy;
  const st = d.agent.status;

  return (
    <AppShell>
      <div className="agent-hero">
        <div className="glow glow-blue" style={{ width: 520, height: 520, left: "auto", right: -120, top: -300 }} aria-hidden="true" />
        <div className="agent-hero-top">
          <div>
            <Link to="/app" className="back back-dark">← Overview</Link>
            <h1 className="agent-name">{d.agent.ens_name}</h1>
            <p className={`agent-st agent-st-${st}`}>{st === "active" ? "● Active" : st === "paused" ? "❚❚ Paused: no payments go out" : "✕ Revoked"}</p>
          </div>
          {st !== "revoked" && (
            <div className="agent-actions">
              <button type="button" className="btn btn-dark-ghost" disabled={busy} onClick={() => setStatus(st === "paused" ? "resume" : "pause")}>{st === "paused" ? "Resume" : "Pause"}</button>
              <button type="button" className="btn btn-dark-danger" disabled={busy} onClick={() => setStatus("revoke")}>Revoke</button>
            </div>
          )}
        </div>
        <div className="agent-cards">
          <div className="glass-mini"><p>Spent today</p><p className="v">{fmt(d.spentToday?.[a], a)}<span> / {fmt(p.autoDaily)}</span></p></div>
          <div className="glass-mini"><p>Everyday wallet</p><p className="v">{fmt(d.balances.hot?.[a], a)}<span> {assetName(a)}</span></p></div>
          <div className="glass-mini"><p>Vault · needs you</p><p className="v">{fmt(d.balances.vault?.[a], a)}<span> {assetName(a)}</span></p></div>
        </div>
      </div>

      <div className="agent-body">
        <div className="agent-main">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>Activity</button>
            <button role="tab" aria-selected={tab === "audit"} className={tab === "audit" ? "on" : ""} onClick={() => setTab("audit")}>Audit log</button>
          </div>
          {tab === "activity" ? (
            <ul className="feed-card">
              {rows.length === 0 && <li className="feed-empty">Nothing yet. Payments and requests show up here live.</li>}
              {rows.map((r) => <ActivityRow key={r.id} r={r} />)}
            </ul>
          ) : (
            <div className="feed-card audit">
              <p className="audit-head">Every decision is also written to a public, append-only log on Hedera. <a href={audit?.topicUrl ?? d.links.audit} target="_blank" rel="noreferrer">Open on HashScan ↗</a></p>
              {(audit?.events ?? []).slice(0, 30).map((e) => (
                <div className="audit-row" key={e.id}>
                  <span className="mono">{e.type}</span>
                  <span className="muted">{e.seq ? `#${e.seq}` : e.error ? "not written" : "pending"}</span>
                  <span className="muted">{ago(e.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="agent-side">
          <div className="side-card">
            <p className="side-card-t">Limits</p>
            <p className="side-card-b">
              Up to <strong>{fmt(p.autoPerPayment)}</strong> a payment and <strong>{fmt(p.autoDaily)}</strong> a day on its own.
              {p.requireApprovalForNewPayee ? " New shops ask you." : ""} Never over <strong>{fmt(p.hardMaxPerPayment)}</strong>.
            </p>
            <p className="side-card-n">USDC · version {d.policy.version} · changes need your World ID</p>
          </div>
          <div className="side-card">
            <p className="side-card-t">Connection</p>
            <dl className="kv">
              <dt>Everyday wallet</dt><dd><a className="mono" href={`https://hashscan.io/testnet/account/${d.agent.hot_account}`} target="_blank" rel="noreferrer">{d.agent.hot_account}</a></dd>
              <dt>Vault</dt><dd><a className="mono" href={`https://hashscan.io/testnet/account/${d.agent.vault_account}`} target="_blank" rel="noreferrer">{d.agent.vault_account}</a></dd>
              <dt>ENS name</dt><dd><a href={d.links.ens} target="_blank" rel="noreferrer">{d.agent.ens_name}</a></dd>
            </dl>
            <p className="side-card-n">Agent uses <span className="mono">@leash/agent-sdk</span> with the keys from setup.</p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function ActivityRow({ r }: { r: Row }) {
  const pay = r.kind === "payment";
  const done = r.status === "settled" || r.status === "applied";
  const bad = ["denied", "expired", "cancelled", "failed"].includes(r.status) || r.decision === "DENY";
  const waiting = r.status === "awaiting_approval";
  const icon = done ? "✓" : bad ? "✕" : waiting ? "◐" : "…";
  const cls = done ? "ok" : bad ? "bad" : "wait";
  const how = pay
    ? r.decision === "AUTO_HOT"
      ? "paid automatically"
      : r.decision === "DENY"
        ? `blocked: ${r.reasons.join(", ")}`
        : r.approval_status === "approved"
          ? "you approved · paid from vault"
          : r.approval_status === "denied"
            ? "you denied"
            : waiting
              ? "waiting for you"
              : r.status
    : r.status === "applied"
      ? "you approved"
      : r.approval_status === "denied" || r.status === "denied"
        ? "you denied"
        : waiting
          ? "waiting for you"
          : r.status;
  const title = pay ? hostOf(r.resource) : r.summary.replace(/^Agent requests spending limits: /, "Limits: ").replace(/^Change spending limits: /, "Limits: ");
  return (
    <li className="act">
      <span className={`tick tick-${cls === "ok" ? "ok" : cls === "bad" ? "bad" : "wait"}`} aria-hidden="true">{icon}</span>
      <span className="act-main">
        <strong>{title}</strong>
        <small>
          {how} · {ago(r.created_at)}
          {r.explorerUrl && <> · <a href={r.explorerUrl} target="_blank" rel="noreferrer">HashScan ↗</a></>}
          {waiting && r.approval_id && <> · <Link to={`/app/approvals/${r.approval_id}`}>Review</Link></>}
        </small>
      </span>
      {pay ? <span className="act-amt">{fmt(r.amount, r.asset)}<small> {assetName(r.asset ?? "")}</small></span> : <span className="muted" style={{ fontSize: 13 }}>limits</span>}
    </li>
  );
}

function hostOf(u?: string) {
  try {
    const x = new URL(u ?? "");
    return x.host + x.pathname;
  } catch {
    return u ?? "payment";
  }
}
