import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { api, ApiError } from "../lib/api";
import { assetName, countdown, fmt } from "../lib/format";
import { openWorldRequest, type WorldParams } from "../lib/world";
import type { Approval as ApprovalT } from "./Overview";

/**
 * The approval screen: facts first (what will happen), warnings, the agent's own words clearly
 * marked as unverified, then Approve with World ID. The World request is minted only when the
 * owner presses Approve (codes expire within 5 min), with "New code" on expiry.
 */
type Full = ApprovalT & { proposedPolicy?: Record<string, any> };
type Step = { s: "idle" } | { s: "code"; url: string; qr: string; expiresAt: number } | { s: "verifying" } | { s: "error"; message: string };

const LIMIT_LABELS: Record<string, string> = {
  autoPerPayment: "Pays on its own, per payment",
  autoDaily: "Pays on its own, per day",
  hardMaxPerPayment: "Never more than, per payment",
};

export function Approval() {
  const { id } = useParams();
  const [ap, setAp] = useState<Full | null>(null);
  const [current, setCurrent] = useState<Record<string, any> | null>(null);
  const [step, setStep] = useState<Step>({ s: "idle" });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [copied, setCopied] = useState(false);
  const [settledTx, setSettledTx] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = async () => {
    const a = await api<Full>("GET", `/approvals/${id}`);
    setAp(a);
    if (a.kind === "policy_change" && !current) api("GET", `/agents/${a.agent.id}`).then((d) => setCurrent(d.policy.policy)).catch(() => {});
    if (a.status === "approved" && a.kind === "payment") {
      const act = await api<any[]>("GET", `/agents/${a.agent.id}/activity?limit=20`).catch(() => []);
      const row = act.find((r) => r.approval_id === a.id && r.tx_id);
      if (row) setSettledTx(row.explorerUrl);
    }
  };

  useEffect(() => {
    load().catch(() => setAp(null));
    const t = setInterval(() => load().catch(() => {}), 4000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
      abort.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const approve = async () => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setCopied(false);
    setStep({ s: "verifying" });
    try {
      const p = await api<WorldParams>("POST", `/approvals/${id}/world-request`);
      const req = await openWorldRequest(p);
      const qr = await QRCode.toDataURL(req.url, { margin: 1, width: 440 });
      if (ac.signal.aborted) return;
      setStep({ s: "code", url: req.url, qr, expiresAt: req.expiresAt });
      const result = await req.wait(ac.signal);
      if (ac.signal.aborted) return;
      setStep({ s: "verifying" });
      await api("POST", `/approvals/${id}/verify`, { result });
      setStep({ s: "idle" });
      await load();
    } catch (e) {
      if (ac.signal.aborted) return;
      const ae = e as ApiError;
      const msg =
        ae.code === "owner_presence_required" || ae.status === 403
          ? "This approval needs the World ID that owns this account."
          : ae.code === "proof_invalid"
            ? "World ID couldn't confirm this approval. Get a new code and try again."
            : ae.message;
      setStep({ s: "error", message: msg });
    }
  };

  const deny = async () => {
    abort.current?.abort();
    await api("POST", `/approvals/${id}/deny`).catch(() => {});
    setStep({ s: "idle" });
    await load();
  };

  if (!ap) return <AppShell><p className="muted">Loading…</p></AppShell>;

  const i = ap.intent;
  const left = Math.max(0, ap.expiresAt - now);
  const pending = ap.status === "pending" && left > 0;
  const codeLeft = step.s === "code" ? Math.max(0, step.expiresAt - now) : 0;

  return (
    <AppShell>
      <div className="approve">
        <Link to="/app" className="back">← Overview</Link>
        <div className="approve-card">
          <div className="approve-head">
            <span>{ap.agent.ens} {ap.kind === "payment" ? "wants to pay" : "wants to change its limits"}</span>
            {pending && <span className="approve-timer">Expires in {countdown(ap.expiresAt, now)}</span>}
          </div>

          {ap.kind === "payment" ? (
            <div className="approve-what">
              <p className="approve-amt">{fmt(i.amount, i.asset)} <span>{assetName(i.asset)}</span></p>
              <p className="approve-to">to <strong className="mono">{i.payTo}</strong> for {hostOf(i.resource)}</p>
            </div>
          ) : (
            <div className="approve-what">
              <p className="approve-amt approve-amt-sm">Raise its limits?</p>
              <table className="diff">
                <tbody>
                  {Object.keys(LIMIT_LABELS).map((k) => {
                    const from = current?.[k];
                    const to = ap.proposedPolicy?.[k];
                    if (to === undefined || from === to) return null;
                    return (
                      <tr key={k}>
                        <td>{LIMIT_LABELS[k]}</td>
                        <td className="num">{from !== undefined ? fmt(from) : "…"}</td>
                        <td aria-hidden="true">→</td>
                        <td className="num strong">{fmt(to)} USDC</td>
                      </tr>
                    );
                  })}
                  {ap.proposedPolicy && current && ap.proposedPolicy.requireApprovalForNewPayee !== current.requireApprovalForNewPayee && (
                    <tr><td>Ask before paying a new shop</td><td>{current.requireApprovalForNewPayee ? "yes" : "no"}</td><td aria-hidden="true">→</td><td className="strong">{ap.proposedPolicy.requireApprovalForNewPayee ? "yes" : "no"}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {ap.warnings.length > 0 && (
            <div className="approve-chips">
              {ap.warnings.map((w) => <span className="chip chip-warn" key={w}>◐ {w}</span>)}
            </div>
          )}

          {ap.agentReason && (
            <div className="agent-says approve-says">
              <p className="lbl">THE AGENT SAYS · UNVERIFIED</p>
              <p>“{ap.agentReason}”</p>
            </div>
          )}

          <p className="approve-check">World App will show: <strong>“{ap.summary}”</strong>. Make sure it matches.</p>

          {/* ---------- actions / states ---------- */}
          {ap.status === "approved" && (
            <div className="approve-done good">
              <p>✓ Approved with World ID.</p>
              {ap.kind === "payment" && (settledTx ? <a href={settledTx} target="_blank" rel="noreferrer">Paid. View the transaction on HashScan →</a> : <span className="muted">Waiting for the agent to finish the payment…</span>)}
              {ap.kind === "policy_change" && <span className="muted">The new limits are active.</span>}
            </div>
          )}
          {ap.status === "denied" && <div className="approve-done bad"><p>✕ Denied. Nothing moved, and the agent was told.</p></div>}
          {ap.status !== "approved" && ap.status !== "denied" && !pending && <div className="approve-done"><p>This request expired. Nothing moved.</p></div>}

          {pending && step.s === "idle" && (
            <div className="btn-row approve-btns">
              <button type="button" className="btn btn-primary" onClick={approve}>Approve with World ID</button>
              <button type="button" className="btn btn-ghost" onClick={deny}>Deny</button>
            </div>
          )}
          {pending && step.s === "verifying" && <p className="approve-wait">Working…</p>}
          {pending && step.s === "error" && (
            <div className="approve-err">
              <p role="alert">{step.message}</p>
              <div className="btn-row"><button type="button" className="btn btn-primary" onClick={approve}>Get a new code</button><button type="button" className="btn btn-ghost" onClick={deny}>Deny</button></div>
            </div>
          )}
          {pending && step.s === "code" && (
            <div className="approve-qr">
              <div className={`qr-box ${codeLeft === 0 ? "qr-expired" : ""}`}>
                <img src={step.qr} alt="World ID approval code. Scan it with World App." width={220} height={220} />
                {codeLeft === 0 && <span className="qr-overlay">Code expired</span>}
              </div>
              <div className="approve-qr-side">
                <p className="strong" style={{ margin: 0 }}>Scan with World App to approve</p>
                <p className="muted mono" style={{ margin: "6px 0 0", fontSize: 12 }}>{codeLeft ? `code expires in ${countdown(step.expiresAt, now)}` : "code expired"}</p>
                <div className="btn-row" style={{ flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-primary" disabled={!codeLeft} onClick={async () => { await navigator.clipboard.writeText(step.url).catch(() => {}); setCopied(true); }}>{copied ? "Copied" : "Copy link for the simulator"}</button>
                  <button type="button" className="btn btn-ghost" onClick={approve}>New code</button>
                </div>
                <button type="button" className="linklike" style={{ marginTop: 12 }} onClick={deny}>Deny instead</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function hostOf(u: string) {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
