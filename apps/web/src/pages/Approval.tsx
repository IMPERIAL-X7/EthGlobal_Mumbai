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

  const agentShort = ap.agent.ens.split(".")[0];
  const approved = ap.status === "approved";
  const denied = ap.status === "denied";
  const expired = !pending && !approved && !denied;
  const tone = approved ? "good" : denied || expired ? "muted" : "warn";

  return (
    <AppShell>
      <div className="approve">
        <Link to="/app" className="back">← Overview</Link>
        <article className={`rcpt rcpt-${tone}`}>
          <header className="rcpt-top">
            <div className="rcpt-row1">
              <span className="rcpt-who">{agentShort} {ap.kind === "payment" ? "wants to pay" : "wants higher limits"}</span>
              {pending && <span className="pill pill-warn">{countdown(ap.expiresAt, now)} left</span>}
              {approved && <span className="pill pill-good">{ap.kind === "payment" ? (settledTx ? "Paid" : "Approved") : "Limits changed"}</span>}
              {denied && <span className="pill pill-muted">Denied</span>}
              {expired && <span className="pill pill-muted">Expired</span>}
            </div>
            {ap.kind === "payment" ? (
              <>
                <p className="rcpt-amt">{fmt(i.amount, i.asset)} <span>{assetName(i.asset)}</span></p>
                <p className="rcpt-to">to <strong>{hostOf(i.resource)}</strong>{i.description ? <> for “{i.description}”</> : null}</p>
              </>
            ) : (
              <>
                <p className="rcpt-amt rcpt-amt-sm">Raise its limits?</p>
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
                  </tbody>
                </table>
              </>
            )}
          </header>

          {!approved && (
            <>
              <dl className="rcpt-facts">
                {ap.kind === "payment" && <><dt>Paid to</dt><dd className="num">{i.payTo}</dd></>}
                {ap.kind === "payment" && <><dt>From</dt><dd>Vault · only with your OK</dd></>}
                <dt>Why you're asked</dt>
                <dd className="rcpt-why">{ap.warnings.length ? ap.warnings.join(" · ") : "Outside your limits"}</dd>
              </dl>
              {ap.agentReason && (
                <div className="rcpt-says">
                  <p className="lbl">Your agent says (not verified)</p>
                  <p>“{ap.agentReason}”</p>
                </div>
              )}
            </>
          )}

          {approved && (
            <ol className="rcpt-steps">
              <li><span className="tick tick-wait" aria-hidden="true">◐</span><span><strong>Paused for you</strong><small>{ap.warnings[0] ?? "outside your limits"}</small></span></li>
              <li><span className="tick tick-ok" aria-hidden="true">✓</span><span><strong>You approved with World ID</strong><small>on your phone, for this exact {ap.kind === "payment" ? "payment" : "change"}</small></span></li>
              {ap.kind === "payment" ? (
                <li>
                  <span className={`tick ${settledTx ? "tick-ok" : "tick-wait"}`} aria-hidden="true">{settledTx ? "✓" : "…"}</span>
                  <span>
                    <strong>{settledTx ? "Paid from your vault" : "Paying from your vault…"}</strong>
                    <small>{settledTx ? <>settled on Hedera · <a href={settledTx} target="_blank" rel="noreferrer">view on HashScan</a></> : "waiting for the agent to finish"}</small>
                  </span>
                </li>
              ) : (
                <li><span className="tick tick-ok" aria-hidden="true">✓</span><span><strong>New limits are active</strong><small>published to ENS and the audit log</small></span></li>
              )}
            </ol>
          )}

          <footer className="rcpt-actions">
            {denied && <p className="rcpt-note">You said no. Nothing moved, and the agent was told.</p>}
            {expired && <p className="rcpt-note">This request expired. Nothing moved.</p>}

            {pending && step.s === "idle" && (
              <>
                <button type="button" className="btn btn-primary rcpt-approve" onClick={approve}>Approve with World ID</button>
                <button type="button" className="btn rcpt-deny" onClick={deny}>Deny</button>
                <p className="rcpt-hint">World App will show the same amount and shop. Check it matches.</p>
              </>
            )}
            {pending && step.s === "verifying" && <p className="rcpt-note">Working…</p>}
            {pending && step.s === "error" && (
              <>
                <p className="rcpt-err" role="alert">{step.message}</p>
                <button type="button" className="btn btn-primary rcpt-approve" onClick={approve}>Get a new code</button>
                <button type="button" className="btn rcpt-deny" onClick={deny}>Deny</button>
              </>
            )}
            {pending && step.s === "code" && (
              <div className="rcpt-qr">
                <div className={`qr-box ${codeLeft === 0 ? "qr-expired" : ""}`}>
                  <img src={step.qr} alt="World ID approval code. Scan it with World App." width={220} height={220} />
                  {codeLeft === 0 && <span className="qr-overlay">Code expired</span>}
                </div>
                <p className="rcpt-qr-t">Scan with World App to approve</p>
                <p className="rcpt-qr-m">{codeLeft ? `code expires in ${countdown(step.expiresAt, now)}` : "code expired"}</p>
                <button type="button" className="btn btn-primary rcpt-approve" disabled={!codeLeft} onClick={async () => { await navigator.clipboard.writeText(step.url).catch(() => {}); setCopied(true); }}>{copied ? "Copied. Paste it in the simulator" : "Copy link for the simulator"}</button>
                <div className="rcpt-qr-row">
                  <button type="button" className="linklike" onClick={approve}>New code</button>
                  <button type="button" className="linklike" onClick={deny}>Deny instead</button>
                </div>
              </div>
            )}
          </footer>
        </article>
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
