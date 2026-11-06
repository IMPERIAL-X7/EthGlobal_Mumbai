/**
 * Demo agent runner (port 4400). Drives both halves of the split-screen demo.
 *
 *   POST /configure {apiKey, agentPrivateKey, hotAccount, vaultAccount}   (or set env vars)
 *   POST /run {side: "legacy"|"leash"|"both", mode: "scripted"|"llm", task?}
 *   GET  /events   SSE stream of narration {side, kind, text}
 *   GET  /status
 *
 * Env: LEASH_API_URL, LEGACY_URL, MERCHANT_URL, LEASH_AGENT_API_KEY, AGENT_ACCOUNT_KEY,
 *      AGENT_HOT_ACCOUNT_ID, AGENT_VAULT_ACCOUNT_ID, ANTHROPIC_API_KEY (llm mode), AGENT_MODEL
 */
import express from "express";
import cors from "cors";
import { LeashAgent } from "@leash/agent-sdk";
import { loadDotenv } from "../../server/src/config.ts";
import { Narrator, type Side } from "./narrator.ts";
import { runLeashScripted, runLegacyScripted } from "./scripted.ts";
import { runAgent, backendAvailable } from "./providers.ts";

loadDotenv();
const env = process.env;
const endpoints = {
  legacyUrl: env.LEGACY_URL ?? "http://localhost:4300",
  merchantUrl: env.MERCHANT_URL ?? "http://localhost:4200",
};
const narrator = new Narrator();
let creds = env.LEASH_AGENT_API_KEY
  ? { apiKey: env.LEASH_AGENT_API_KEY!, agentPrivateKey: env.AGENT_ACCOUNT_KEY!, hotAccount: env.AGENT_HOT_ACCOUNT_ID!, vaultAccount: env.AGENT_VAULT_ACCOUNT_ID! }
  : null;
const running = new Set<Side>();

const leashAgent = () => {
  if (!creds) throw new Error("no agent credentials: POST /configure first (or set LEASH_AGENT_API_KEY etc.)");
  return new LeashAgent({ apiUrl: env.LEASH_API_URL ?? "http://localhost:4000/v1", ...creds, approvalTimeoutSec: 600 });
};

const DEFAULT_TASK =
  "Pay the invoices in Alice's inbox. For the Leash wallet, the invoice is the premium report at " +
  `${endpoints.merchantUrl}/report/premium; afterwards buy the forecast at ${endpoints.merchantUrl}/forecast. ` +
  "Then handle any urgent emails.";

async function run(side: Side, mode: "scripted" | "llm", task: string) {
  if (running.has(side)) throw new Error(`${side} already running`);
  running.add(side);
  try {
    if (mode === "scripted") {
      if (side === "legacy") await runLegacyScripted(endpoints, narrator);
      else await runLeashScripted(endpoints, leashAgent(), narrator);
    } else {
      await runAgent(side, task, endpoints, narrator, side === "leash" ? leashAgent() : undefined, { model: env.AGENT_MODEL || "cli:sonnet" });
    }
  } catch (e) {
    narrator.say(side, "error", (e as Error).message);
  } finally {
    running.delete(side);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.post("/configure", (req, res) => {
  const { apiKey, agentPrivateKey, hotAccount, vaultAccount } = req.body ?? {};
  if (!apiKey || !agentPrivateKey || !hotAccount || !vaultAccount) return void res.status(400).json({ error: "apiKey, agentPrivateKey, hotAccount, vaultAccount required" });
  creds = { apiKey, agentPrivateKey, hotAccount, vaultAccount };
  res.json({ ok: true });
});

app.post("/run", (req, res) => {
  const side: Side | "both" = req.body?.side ?? "both";
  const mode = req.body?.mode === "llm" ? "llm" : "scripted";
  const task = String(req.body?.task ?? DEFAULT_TASK);
  if (side !== "legacy" && !creds) return void res.status(400).json({ error: "configure agent credentials first" });
  narrator.clear();
  const sides: Side[] = side === "both" ? ["legacy", "leash"] : [side];
  for (const s of sides) void run(s, mode, task);
  res.status(202).json({ started: sides, mode });
});

app.get("/events", (req, res) => {
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.flushHeaders();
  for (const n of narrator.history) res.write(`data: ${JSON.stringify(n)}\n\n`);
  const off = narrator.on((n) => res.write(`data: ${JSON.stringify(n)}\n\n`));
  req.on("close", off);
});

app.get("/status", (_req, res) => res.json({ configured: !!creds, running: [...running], endpoints, llm: backendAvailable(env.AGENT_MODEL || "cli:sonnet") === null, model: env.AGENT_MODEL || "cli:sonnet" }));

const port = Number(env.AGENT_PORT ?? 4400);
app.listen(port, () => console.log(`demo agent runner on :${port}`));
