import { useEffect, useState } from "react";

/**
 * The pitch as a loop: small payments flow through on their own, then a big one to a new payee
 * stops and waits for the owner, who approves with World ID; it settles from the vault.
 * Reduced motion: shows the "waiting for you" state, still.
 */
type Row = { what: string; where: string; amt: string; state: "auto" | "held" | "settled" };

const SMALL: Row[] = [
  { what: "7-day forecast", where: "weather-pro", amt: "0.05", state: "auto" },
  { what: "Invoice #1042", where: "acme-billing", amt: "0.40", state: "auto" },
  { what: "7-day forecast", where: "weather-pro", amt: "0.05", state: "auto" },
];
const BIG: Row = { what: "Premium climate report", where: "a shop it's never paid", amt: "2.50", state: "held" };

// phase: 0..3 small rows appear, 4 big row held, 5 approval card, 6 approving, 7 settled
const STEP_MS = [900, 900, 900, 1200, 1600, 1800, 1600, 2600];

export function HeroWallet() {
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState(reduced ? 5 : 0);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setPhase((p) => (p + 1) % STEP_MS.length), STEP_MS[phase]);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  const rows: Row[] = SMALL.slice(0, Math.min(phase, 3));
  if (phase >= 4) rows.push({ ...BIG, state: phase >= 7 ? "settled" : "held" });
  const visible = rows.slice().reverse(); // newest on top

  return (
    <div className="ui-card" role="img" aria-label="Animated example: small agent payments go through automatically; a 2.50 USDC payment to a new payee waits for the owner's World ID approval, then settles from the vault.">
      <div className="ui-card-head">
        <span>shopper.leash.eth · activity</span>
        <span>auto-limit 1.00 USDC</span>
      </div>
      <ul className="feed" aria-hidden="true">
        {visible.length === 0 && (
          <li className="feed-row">
            <span className="feed-main"><span className="where">Agent is working…</span></span>
          </li>
        )}
        {visible.map((r, i) => (
          <li key={`${phase >= 4 && i === 0 ? "big" : "s"}-${rows.length - i}`} className={`feed-row ${r.state === "held" ? "held" : ""}`}>
            <span className={`tick ${r.state === "held" ? "tick-wait" : "tick-ok"}`} aria-hidden="true">{r.state === "held" ? "◐" : "✓"}</span>
            <span className="feed-main">
              <span className="what">{r.what}</span>
              <span className="where">
                {r.where} · {r.state === "auto" ? "paid automatically" : r.state === "held" ? "waiting for you" : "you approved · paid from vault"}
              </span>
            </span>
            <span className="amt">{r.amt}<small> USDC</small></span>
          </li>
        ))}
      </ul>
      {phase >= 5 && phase < 7 && (
        <div className="approval" aria-hidden="true">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Approve this payment?</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--bad)", fontWeight: 600 }}>EXPIRES 9:41</span>
          </div>
          <p className="big">2.50 USDC</p>
          <p className="to">to <strong>0.0.6001</strong> · first payment to this address · over your 1.00 auto-limit</p>
          <div className="agent-says">
            <p className="lbl">THE AGENT SAYS · UNVERIFIED</p>
            <p>“Premium report needed for the trip plan.”</p>
          </div>
          <div className="btn-row">
            <span className={`btn btn-primary ${phase === 6 ? "world-pulse" : ""}`}>{phase === 6 ? "Waiting for World App…" : "Approve with World ID"}</span>
            <span className="btn btn-ghost">Deny</span>
          </div>
        </div>
      )}
    </div>
  );
}
