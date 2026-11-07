import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { assetName, countdown, fmt, mainAsset } from "../lib/format";

type Agent = { id: string; label: string; ens_name: string; status: "active" | "paused" | "revoked"; hot_account: string; vault_account: string; created_at: number };
type Detail = { agent: Agent; balances: { hot: Record<string, string>; vault: Record<string, string> }; spentToday: Record<string, string>; policy: { policy: { autoDaily: string; autoPerPayment: string } } };
export type Approval = {
  id: string;
  status: string;
  agent: { id: string; ens: string };
  kind: "payment" | "policy_change";
  summary: string;
  agentReason?: string;
  warnings: string[];
  intent: any;
  expiresAt: number;
  createdAt: number;
};

export function Overview() {
  const [params] = useSearchParams();
  const [agents, setAgents] = useState<Detail[] | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const me = await api<{ agents: Agent[] }>("GET", "/me");
      const details = await Promise.all(me.agents.filter((a) => a.status !== "revoked").map((a) => api<Detail>("GET", `/agents/${a.id}`).catch(() => null)));
      const ap = await api<Approval[]>("GET", "/approvals?status=pending").catch(() => []);
      if (!alive) return;
      setAgents(details.filter(Boolean) as Detail[]);
      setPending(ap);
    };
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 5000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(c);
    };
  }, []);

  // Totals in each agent's main asset; the demo runs on one asset, so we headline that one.
  const asset = mainAsset(agents?.[0]?.balances.vault ?? agents?.[0]?.balances.hot);
  const spent = (agents ?? []).reduce((s, d) => s + Number(d.spentToday?.[asset] ?? 0), 0);
  const inVaults = (agents ?? []).reduce((s, d) => s + Number(d.balances.vault?.[asset] ?? 0), 0);
  const waitingFor = new Set(pending.map((p) => p.agent.id));

  const rail = (
    <div className="rail">
      <p className="rail-title">Waiting for you</p>
      {pending.length === 0 && <p className="rail-empty">Nothing right now. When an agent needs you, it shows up here.</p>}
      {pending.map((p) => (
        <div className="rail-card" key={p.id}>
          <p className="rail-agent">{p.agent.ens}</p>
          {p.kind === "payment" ? (
            <p className="rail-amt">{fmt(p.intent.amount, p.intent.asset)} <span>{assetName(p.intent.asset)}</span></p>
          ) : (
            <p className="rail-amt rail-amt-sm">{p.summary.replace(/^Agent requests spending limits: /, "")}</p>
          )}
          <p className="rail-meta">{p.kind === "policy_change" ? "Limit change · " : ""}{p.warnings.slice(0, 2).join(" · ") || p.summary} · {countdown(p.expiresAt, now)} left</p>
          <Link to={`/app/approvals/${p.id}`} className="btn btn-primary rail-btn">Review &amp; approve</Link>
        </div>
      ))}
    </div>
  );

  return (
    <AppShell rail={rail}>
      <div className="page-head">
        <h1 className="page-title">Overview</h1>
        <Link to="/app/agents/new" className="btn btn-primary">+ New agent</Link>
      </div>
      {params.get("welcome") && <div className="notice">✓ Your Leash account is ready. It's tied to your World ID: no password to lose. Add your first agent to get started.</div>}

      <div className="kpis">
        <div className="kpi"><p className="kpi-l">Spent today, all agents</p><p className="kpi-v">{fmt(spent, asset)}<span> {assetName(asset)}</span></p></div>
        <div className="kpi"><p className="kpi-l">In vaults</p><p className="kpi-v">{fmt(inVaults, asset)}<span> {assetName(asset)}</span></p></div>
        <div className={`kpi ${pending.length ? "kpi-warn" : ""}`}><p className="kpi-l">Waiting for you</p><p className="kpi-v">{pending.length}</p></div>
      </div>

      <div className="table-card">
        <div className="trow thead"><span>Agent</span><span>Status</span><span>Today</span><span className="r">Vault</span></div>
        {agents === null && <div className="trow"><span className="muted">Loading…</span></div>}
        {agents?.length === 0 && (
          <div className="empty">
            <p className="empty-t">No agents yet</p>
            <p className="muted">Create one: name it, set its limits in plain English, connect it. About two minutes.</p>
            <Link to="/app/agents/new" className="btn btn-primary">Create your first agent</Link>
          </div>
        )}
        {agents?.map((d) => {
          const a = mainAsset(d.balances.vault ?? d.balances.hot);
          const today = Number(d.spentToday?.[a] ?? 0);
          const cap = Number(d.policy.policy.autoDaily);
          const pct = cap ? Math.min(100, (today / cap) * 100) : 0;
          const needs = waitingFor.has(d.agent.id);
          return (
            <Link to={`/app/agents/${d.agent.id}`} className={`trow ${needs ? "trow-warn" : ""}`} key={d.agent.id}>
              <span className="strong">{d.agent.ens_name}</span>
              <span className={`status status-${needs ? "needs" : d.agent.status}`}>
                {needs ? "◐ Needs you" : d.agent.status === "active" ? "● Active" : d.agent.status === "paused" ? "❚❚ Paused" : "✕ Revoked"}
              </span>
              <span className="today">
                {fmt(today, a)} / {fmt(cap, a)}
                <span className="mini-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} className={pct > 80 ? "hot" : ""} /></span>
              </span>
              <span className="r num">{fmt(d.balances.vault?.[a], a)}</span>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
