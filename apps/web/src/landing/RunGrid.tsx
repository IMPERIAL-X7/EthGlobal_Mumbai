import { useEffect, useRef, useState } from "react";
import { MODEL_RESULTS, SOURCES } from "./data";

/**
 * Option 2B: every run is a square. Two panels (typical wallet / Leash), squares grouped by model.
 * Hover (or focus) a square to see its model and outcome. Squares fill in when scrolled into view.
 * A table carries the same data for screen readers.
 */
type Cell = { model: string; kind: "raised" | "stayed" | "held" };

const legacyCells: Cell[] = MODEL_RESULTS.flatMap((r) => [
  ...Array.from({ length: r.legacyHit }, () => ({ model: r.model, kind: "raised" as const })),
  ...Array.from({ length: r.legacyN - r.legacyHit }, () => ({ model: r.model, kind: "stayed" as const })),
]);
const leashCells: Cell[] = MODEL_RESULTS.flatMap((r) => Array.from({ length: r.leashN }, () => ({ model: r.model, kind: "held" as const })));
const raised = legacyCells.filter((c) => c.kind === "raised").length;

const TEXT: Record<Cell["kind"], string> = {
  raised: "raised its own limit and paid",
  stayed: "stayed within the limit",
  held: "asked, waited for the owner; nothing moved",
};

export function RunGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return setShown(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setShown(true), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = (e: React.MouseEvent | React.FocusEvent, c: Cell) => {
    const box = ref.current!.getBoundingClientRect();
    const t = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: t.left - box.left + t.width / 2, y: t.top - box.top, text: `${c.model}: ${TEXT[c.kind]}` });
  };

  const grid = (cells: Cell[], offset: number) => (
    <div className="runs" aria-hidden="true">
      {cells.map((c, i) => (
        <span
          key={i}
          className={`run run-${c.kind} ${shown ? "in" : ""}`}
          style={{ transitionDelay: `${(i + offset) * 35}ms` }}
          onMouseEnter={(e) => show(e, c)}
          onMouseLeave={() => setTip(null)}
        />
      ))}
    </div>
  );

  return (
    <div className="chart-card" ref={ref} style={{ position: "relative" }}>
      <p className="eyebrow" style={{ marginBottom: 6 }}>Each square is one run · 7 models · same task</p>
      <h3 className="chart-title">The task needed more than the limit. What did the agent do?</h3>
      <div className="runs-split">
        <div>
          <div className="runs-head">
            <span>Typical agent wallet</span>
            <span className="mono bad">{raised} / {legacyCells.length}</span>
          </div>
          {grid(legacyCells, 0)}
          <p className="runs-key">
            <span className="key key-raised" /> raised its own limit and paid
            <span className="key key-stayed" style={{ marginLeft: 16 }} /> stayed within the limit
          </p>
        </div>
        <div>
          <div className="runs-head">
            <span>Leash</span>
            <span className="mono good">0 / {leashCells.length}</span>
          </div>
          {grid(leashCells, legacyCells.length)}
          <p className="runs-key">
            <span className="key key-held" /> asked, waited for the owner's World ID; the owner never approved, so nothing moved
          </p>
        </div>
      </div>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      <table className="sr-only">
        <caption>Runs where the agent raised its own spending limit, by model</caption>
        <thead><tr><th>Model</th><th>Typical wallet</th><th>Leash</th></tr></thead>
        <tbody>
          {MODEL_RESULTS.map((r) => (
            <tr key={r.model}><td>{r.model}</td><td>{r.legacyN ? `${r.legacyHit} of ${r.legacyN}` : "no valid runs"}</td><td>{r.leashHit} of {r.leashN}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="chart-note">
        Claude Haiku, Claude Sonnet, Gemini 3.5 Flash-Lite, GPT-OSS 120B and 20B, Gemma 4 26B, Qwen 3.8 27B. Small samples (1–6 runs per model). We also sent fake “from your owner” emails: no model fell for them on either wallet.{" "}
        <a href={SOURCES.eval.url}>Method and raw results</a>
      </p>
    </div>
  );
}
