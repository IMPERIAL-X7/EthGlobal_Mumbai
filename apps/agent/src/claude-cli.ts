/**
 * Claude via the locally logged-in Claude Code CLI (`claude -p`), i.e. the user's own Pro/Max
 * subscription instead of a paid API key. The tools are served by mcp-server.ts; Claude Code's
 * built-in tools are disabled and its system prompt is replaced, so the agent sees exactly the
 * same prompt + tools as the API backend.
 *
 * Model spec: "cli:sonnet" | "cli:haiku" | "cli:opus" | "cli:<full model id>"
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeashAgent } from "@leash/agent-sdk";
import type { Narrator, Side } from "./narrator.ts";
import type { Endpoints } from "./tools.ts";
import { SYSTEM_PROMPT, type LlmRunResult, type RunOpts } from "./toolset.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(here, "../../..");

/** Pre-bundle the MCP server once per process: `node x.mjs` starts in ~0.6s vs ~2.5s+ for tsx, and
 *  a slow start loses the race with `claude -p`'s first turn (the model then runs without tools). */
let bundle: Promise<string> | null = null;
function mcpBundle(): Promise<string> {
  bundle ??= (async () => {
    const esbuild = await import("esbuild");
    const outfile = join(ROOT, "apps/agent/dist/mcp-server.mjs");
    await esbuild.build({
      entryPoints: [join(here, "mcp-server.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile,
      banner: { js: 'import{createRequire as __cr}from"module";const require=__cr(import.meta.url);' },
      logLevel: "warning",
    });
    return outfile;
  })();
  return bundle;
}

export async function runClaudeCli(
  side: Side,
  task: string,
  e: Endpoints,
  n: Narrator,
  leash: LeashAgent | undefined,
  opts: RunOpts & { model: string },
): Promise<LlmRunResult> {
  const model = opts.model.replace(/^cli:/, "");
  const maxTurns = opts.maxTurns ?? 12;
  if (side === "leash" && !leash) throw new Error("leash side needs agent credentials");
  const mcp = {
    mcpServers: {
      wallet: {
        command: process.execPath,
        args: [await mcpBundle()],
        env: {
          LEASH_MCP_SIDE: side,
          LEGACY_URL: e.legacyUrl,
          MERCHANT_URL: e.merchantUrl,
          ...(leash ? { LEASH_AGENT_CONFIG: JSON.stringify(leash.cfg) } : {}),
        },
      },
    },
  };
  const args = [
    "-p", task,
    "--model", model,
    "--system-prompt", SYSTEM_PROMPT,
    "--tools", "",
    "--mcp-config", JSON.stringify(mcp),
    "--strict-mcp-config",
    "--allowedTools", "mcp__wallet",
    "--permission-mode", "dontAsk",
    "--max-turns", String(maxTurns),
    "--output-format", "stream-json",
    "--verbose",
  ];
  // Never let the CLI pick up an API key from .env — that would bill the key, not the subscription.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  env.MCP_TIMEOUT ??= "60000"; // tsx cold start of the wallet MCP server can be slow under load
  n.say(side, "info", `LLM mode (claude -p --model ${model}, subscription) — task: ${task}`);

  for (let attempt = 1; ; attempt++) {
    const r = await spawnOnce(args, env, side, n, opts.model);
    if (r !== "mcp_not_ready") return r;
    if (attempt >= 5) return { model: opts.model, turns: 0, usage: { input: 0, output: 0, cacheRead: 0 }, outcome: "error", costUsd: 0, error: "wallet MCP server never connected" };
    n.say(side, "info", "wallet tools not connected yet — retrying");
  }
}

function spawnOnce(args: string[], env: NodeJS.ProcessEnv, side: Side, n: Narrator, modelSpec: string): Promise<LlmRunResult | "mcp_not_ready"> {
  return new Promise((resolveRun) => {
    // Run from an empty dir so no project CLAUDE.md / memory leaks into the agent's context.
    const child = spawn("claude", args, { cwd: mkdtempSync(join(tmpdir(), "leash-cli-")), env, stdio: ["ignore", "pipe", "pipe"] });
    let notReady = false;
    const result: LlmRunResult = { model: modelSpec, turns: 0, usage: { input: 0, output: 0, cacheRead: 0 }, outcome: "error", costUsd: 0 };
    let buf = "";
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === "system" && ev.subtype === "init") {
          // A model turn must never start without the wallet tools, or the run measures nothing.
          if (!(ev.tools ?? []).some((t: string) => t.startsWith("mcp__wallet__"))) {
            notReady = true;
            console.error(`  [claude-cli] init without wallet tools: mcp=${JSON.stringify(ev.mcp_servers)} tools=${(ev.tools ?? []).length}`);
            child.kill();
            return;
          }
        } else if (ev.type === "assistant") {
          for (const b of ev.message?.content ?? []) {
            if (b.type === "text" && b.text.trim()) n.say(side, "thought", b.text.trim());
            if (b.type === "tool_use") n.say(side, "action", `${String(b.name).replace(/^mcp__wallet__/, "")}(${JSON.stringify(b.input)})`);
          }
        } else if (ev.type === "user") {
          for (const b of ev.message?.content ?? []) {
            if (b.type !== "tool_result") continue;
            const text = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : String(b.content ?? "");
            n.say(side, b.is_error ? "error" : "result", text.slice(0, 240));
          }
        } else if (ev.type === "result") {
          result.turns = ev.num_turns ?? 0;
          result.usage.input = (ev.usage?.input_tokens ?? 0) + (ev.usage?.cache_creation_input_tokens ?? 0);
          result.usage.output = ev.usage?.output_tokens ?? 0;
          result.usage.cacheRead = ev.usage?.cache_read_input_tokens ?? 0;
          result.outcome = ev.subtype === "success" ? "done" : ev.subtype === "error_max_turns" ? "max_turns" : "error";
          if (ev.subtype !== "success") result.error = ev.subtype;
        }
      }
    });
    child.on("close", (code) => {
      if (notReady) return resolveRun("mcp_not_ready");
      if (result.outcome === "error" && !result.error) result.error = `claude exited ${code}: ${stderr.slice(0, 300)}`;
      n.say(side, result.outcome === "error" ? "error" : "done", result.outcome === "done" ? "Agent finished." : `Agent stopped (${result.error})`);
      resolveRun(result);
    });
  });
}
