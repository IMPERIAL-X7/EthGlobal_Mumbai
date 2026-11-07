import { useEffect, useRef, useState } from "react";

/**
 * "How Leash works" as two receipts: what happens to a small payment vs a big or new one.
 * Lines tick in one by one when scrolled into view (static with reduced motion).
 */
type Line = { mark: "ok" | "wait"; text: string; sub?: string };

const SMALL: Line[] = [
  { mark: "ok", text: "Within your limits", sub: "under 1.00 per payment, under today's budget" },
  { mark: "ok", text: "Paid automatically", sub: "from the agent's everyday wallet" },
  { mark: "ok", text: "Settled on Hedera in seconds", sub: "and written to your audit log" },
];
const BIG: Line[] = [
  { mark: "wait", text: "Paused: first time paying this shop", sub: "the agent can't continue on its own" },
  { mark: "ok", text: "You approved with World ID", sub: "on your phone, for this exact payment" },
  { mark: "ok", text: "Paid from your vault", sub: "which the agent can't open by itself" },
  { mark: "ok", text: "Settled on Hedera in seconds", sub: "and written to your audit log" },
];

function Receipt({ title, amount, to, lines, shown, offset, tone }: { title: string; amount: string; to: string; lines: Line[]; shown: boolean; offset: number; tone: "good" | "warn" }) {
  return (
    <article className={`receipt receipt-${tone}`}>
      <header className="receipt-top">
        <p className="receipt-title">{title}</p>
        <p className="receipt-amt">{amount} <span>USDC</span></p>
        <p className="receipt-to">to {to}</p>
      </header>
      <ol className="receipt-lines">
        {lines.map((l, i) => (
          <li key={i} className={shown ? "in" : ""} style={{ transitionDelay: `${(offset + i) * 260}ms` }}>
            <span className={`tick tick-${l.mark}`} aria-hidden="true">{l.mark === "ok" ? "✓" : "◐"}</span>
            <span>
              <strong>{l.text}</strong>
              {l.sub && <small>{l.sub}</small>}
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function FlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <div className="receipts">
        <Receipt title="A small payment" amount="0.05" to="weather-pro" lines={SMALL} shown={shown} offset={0} tone="good" />
        <Receipt title="A big or new payment" amount="2.50" to="a shop it's never paid" lines={BIG} shown={shown} offset={1} tone="warn" />
      </div>
      <p className="receipts-foot">
        Your agent can ask for higher limits, but only you can approve them, the same way. Sellers can look up any agent by its name (like <span className="mono">shopper.leash.eth</span>) to see if it's active.
      </p>
    </div>
  );
}
