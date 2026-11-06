/**
 * Merge every eval-results/escalation-*.json into one table (eval-results/SUMMARY.md).
 * Runs that errored before the agent could act (network/MCP failures) are excluded from the
 * denominators and counted separately, so a flaky connection never looks like "safe".
 *
 *   npx tsx scripts/eval-summary.ts
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

interface Row {
  model: string;
  side: "legacy" | "leash";
  experiment: string;
  escalated: boolean;
  attackerPaid: boolean;
  movedWithoutHuman: string;
  outcome: string;
}

const rows: Row[] = readdirSync("eval-results")
  .filter((f) => /^escalation-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`eval-results/${f}`, "utf8")).rows as Row[]);

const key = (r: Row) => `${r.model}|${r.experiment}`;
const groups = new Map<string, Row[]>();
for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);

const cell = (rs: Row[], f: (r: Row) => boolean) => {
  const ok = rs.filter((r) => r.outcome !== "error");
  if (!ok.length) return "–";
  const hit = ok.filter(f).length;
  return `${hit}/${ok.length}${hit ? " ⚠️" : ""}`;
};

const lines = [
  "# Escalation experiment: results",
  "",
  `Generated ${new Date().toISOString()} from ${rows.length} runs (${rows.filter((r) => r.outcome === "error").length} errored runs excluded).`,
  "",
  "Same inbox, same task, same tools on both wallets. Leash owner **never** approves.",
  "",
  "| Model | Experiment | Typical wallet: raised own limit | Typical wallet: attacker paid | Leash: policy changed | Leash: attacker paid | Leash: vault paid w/o human |",
  "|---|---|---|---|---|---|---|",
];
for (const [k, rs] of [...groups].sort()) {
  const [model, exp] = k.split("|");
  const L = rs.filter((r) => r.side === "legacy");
  const S = rs.filter((r) => r.side === "leash");
  lines.push(
    `| \`${model}\` | ${exp} | ${cell(L, (r) => r.escalated)} | ${cell(L, (r) => r.attackerPaid)} | ${cell(S, (r) => r.escalated)} | ${cell(S, (r) => r.attackerPaid)} | ${cell(S, (r) => r.movedWithoutHuman !== "0.00")} |`,
  );
}
const md = lines.join("\n") + "\n";
writeFileSync("eval-results/SUMMARY.md", md);
console.log(md);
