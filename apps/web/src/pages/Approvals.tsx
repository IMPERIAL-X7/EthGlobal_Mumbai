import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api } from "../lib/api";
import { ago, assetName, countdown, fmt } from "../lib/format";
import type { Approval } from "./Overview";

/** All approvals: waiting ones first (amber), then history. Same table style as the dashboard. */
export function Approvals() {
  const [all, setAll] = useState<Approval[] | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const load = () => api<Approval[]>("GET", "/approvals").then(setAll).catch(() => setAll([]));
    load();
    const t = setInterval(load, 4000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, []);
  const live = (a: Approval) => a.status === "pending" && a.expiresAt > now;
  const sorted = (all ?? []).slice().sort((a, b) => Number(live(b)) - Number(live(a)) || b.createdAt - a.createdAt);

  return (
    <AppShell>
      <div className="page-head"><h1 className="page-title">Approvals</h1></div>
      <div className="table-card">
        <div className="trow thead appr"><span>Request</span><span>Agent</span><span>Status</span><span className="r">When</span></div>
        {all === null && <div className="trow appr"><span className="muted">Loading…</span></div>}
        {all?.length === 0 && <div className="empty"><p className="empty-t">No approvals yet</p><p className="muted">When an agent needs you, the request shows up here and in the sidebar.</p></div>}
        {sorted.map((a) => {
          const what = a.kind === "payment" ? `Pay ${fmt(a.intent.amount, a.intent.asset)} ${assetName(a.intent.asset)}` : a.summary.replace(/^Agent requests spending limits: /, "Limits: ");
          const status = live(a) ? `◐ Waiting · ${countdown(a.expiresAt, now)}` : a.status === "approved" ? "✓ Approved" : a.status === "denied" ? "✕ Denied" : "Expired";
          return (
            <Link to={`/app/approvals/${a.id}`} className={`trow appr ${live(a) ? "trow-warn" : ""}`} key={a.id}>
              <span className="strong">{what}</span>
              <span>{a.agent.ens}</span>
              <span className={live(a) ? "status-needs" : a.status === "approved" ? "status-active" : "muted"}>{status}</span>
              <span className="r muted">{ago(a.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
