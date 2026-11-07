/**
 * Every number on the landing page comes from here, with its source. No invented figures.
 * Eval numbers: eval-results/SUMMARY.md (benign experiment, errored runs excluded, Nov 6 2026).
 */

export const SOURCES = {
  chainalysis: {
    label: "Chainalysis, “Agentic Payments Cross the Threshold”, Jun 3 2026",
    url: "https://www.chainalysis.com/blog/x402-agentic-payments-adoption/",
  },
  csa: {
    label: "Cloud Security Alliance survey (418 IT & security professionals, Jan 2026; commissioned by Token Security), Apr 21 2026",
    url: "https://cloudsecurityalliance.org/press-releases/2026/04/21/new-cloud-security-alliance-survey-reveals-82-of-enterprises-have-unknown-ai-agents-in-their-environments",
  },
  eval: {
    label: "Leash escalation experiment (our own runs, method + raw results on GitHub), Nov 6 2026",
    url: "https://github.com/IMPERIAL-X7/EthGlobal_Mumbai/tree/main/eval-results",
  },
} as const;

/** Benign task ("pay these invoices", needs more than the default limit). */
export const MODEL_RESULTS: { model: string; provider: string; legacyHit: number; legacyN: number; leashHit: number; leashN: number }[] = [
  { model: "Claude Haiku", provider: "Anthropic", legacyHit: 6, legacyN: 6, leashHit: 0, leashN: 6 },
  { model: "Claude Sonnet", provider: "Anthropic", legacyHit: 4, legacyN: 4, leashHit: 0, leashN: 4 },
  { model: "Gemini 3.5 Flash-Lite", provider: "Google", legacyHit: 3, legacyN: 3, leashHit: 0, leashN: 3 },
  { model: "GPT-OSS 120B", provider: "OpenAI (open weights)", legacyHit: 3, legacyN: 3, leashHit: 0, leashN: 3 },
  { model: "Gemma 4 26B", provider: "Google (open weights)", legacyHit: 2, legacyN: 2, leashHit: 0, leashN: 2 },
  { model: "Qwen 3.8 27B", provider: "Alibaba (open weights)", legacyHit: 2, legacyN: 3, leashHit: 0, leashN: 3 },
  // No valid typical-wallet runs (provider errors), one valid Leash run.
  { model: "GPT-OSS 20B", provider: "OpenAI (open weights)", legacyHit: 0, legacyN: 0, leashHit: 0, leashN: 1 },
];

/** Real testnet artifacts from the live runs on Nov 6 2026. */
export const PROOF = {
  vaultTx: "0.0.7162784@1793987034.078590210",
  hotTx: "0.0.7162784@1793987040.900285473",
  auditTopic: "0.0.11342153",
  ensParent: "leash.eth",
  ensSample: "ens-e00d9a.leash.eth",
};
export const hashscanTx = (id: string) => `https://hashscan.io/testnet/transaction/${id}`;
