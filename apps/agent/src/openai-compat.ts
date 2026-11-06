/**
 * Non-Anthropic backends through the OpenAI-compatible chat-completions protocol (plain fetch,
 * no extra SDK). Used only by the escalation experiment / LLM demo mode to compare models.
 *
 * Model spec: "<provider>:<model>", e.g.
 *   github:openai/gpt-4.1-mini         GITHUB_MODELS_TOKEN (fine-grained PAT, "Models: read") — free tier
 *   groq:qwen/qwen3-32b                GROQ_API_KEY       — free tier
 *   gemini:gemini-2.5-flash            GEMINI_API_KEY     — free tier (Google AI Studio)
 *   openrouter:qwen/qwen3-8b:free      OPENROUTER_API_KEY — ":free" models cost nothing
 *   ollama:qwen2.5:3b                  local Ollama, no key
 */
import { setDefaultResultOrder } from "node:dns";
import type { LeashAgent } from "@leash/agent-sdk";
import type { Narrator, Side } from "./narrator.ts";
import type { Endpoints } from "./tools.ts";
import { SYSTEM_PROMPT, makeExecutor, toolSpecs, type LlmRunResult, type RunOpts } from "./toolset.ts";

// Some networks (hotel / venue Wi-Fi) advertise IPv6 but can't route it; Node then fails with ENETUNREACH.
setDefaultResultOrder("ipv4first");

export const OPENAI_COMPAT_PROVIDERS: Record<string, { url: string; keyEnv?: string }> = {
  github: { url: "https://models.github.ai/inference/chat/completions", keyEnv: "GITHUB_MODELS_TOKEN" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", keyEnv: "GROQ_API_KEY" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", keyEnv: "GEMINI_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", keyEnv: "OPENROUTER_API_KEY" },
  ollama: { url: `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/v1/chat/completions` },
};

export function isOpenAICompat(spec: string) {
  const p = spec.split(":")[0]!;
  return p in OPENAI_COMPAT_PROVIDERS;
}

type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export async function runOpenAICompat(
  side: Side,
  task: string,
  e: Endpoints,
  n: Narrator,
  leash: LeashAgent | undefined,
  opts: RunOpts & { model: string },
): Promise<LlmRunResult> {
  const [provider, ...rest] = opts.model.split(":");
  const model = rest.join(":");
  const cfg = OPENAI_COMPAT_PROVIDERS[provider!]!;
  const key = cfg.keyEnv ? process.env[cfg.keyEnv] : undefined;
  if (cfg.keyEnv && !key) throw new Error(`${cfg.keyEnv} is not set (needed for ${provider}:)`);
  const maxTurns = opts.maxTurns ?? 12;
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const exec = makeExecutor(side, e, n, leash);
  const tools = toolSpecs(side).map((t) => ({ type: "function", function: t }));
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  n.say(side, "info", `LLM mode (${opts.model}) — task: ${task}`);

  for (let turn = 0; turn < maxTurns; turn++) {
    let data: any;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(cfg.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ model, messages, tools, temperature: 0.7 }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (err) {
        if (attempt >= 4) throw err; // flaky venue Wi-Fi: retry dropped connections / timeouts
        n.say(side, "info", `${provider} network error (${(err as Error).message}), retrying`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const wait = Number(res.headers.get("retry-after") ?? 5 * (attempt + 1)) * 1000;
        n.say(side, "info", `${provider} ${res.status}, retrying in ${Math.round(wait / 1000)}s`);
        await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
        continue;
      }
      data = await res.json().catch(() => null);
      // Groq validates tool calls server-side; a hallucinated tool name comes back as a 400. Re-sample.
      if (res.status === 400 && /tool call validation failed|tool_use_failed|output_parse_failed/.test(JSON.stringify(data)) && attempt < 4) {
        n.say(side, "info", `model produced an invalid tool call, re-sampling`);
        continue;
      }
      if (!res.ok) throw new Error(`${provider} ${res.status}: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
      if (!data?.choices) throw new Error(`${provider}: unexpected response ${JSON.stringify(data).slice(0, 200)}`);
      break;
    }
    usage.input += data.usage?.prompt_tokens ?? 0;
    usage.output += data.usage?.completion_tokens ?? 0;
    const msg = data.choices?.[0]?.message ?? {};
    const calls = (msg.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[];
    messages.push({ role: "assistant", content: msg.content ?? null, ...(calls.length ? { tool_calls: calls.map((c) => ({ ...c, type: "function" as const })) } : {}) });
    if (typeof msg.content === "string" && msg.content.trim()) n.say(side, "thought", msg.content.trim());
    if (!calls.length) {
      n.say(side, "done", "Agent finished.");
      return { model: opts.model, turns: turn + 1, usage, outcome: "done", costUsd: 0 };
    }
    for (const c of calls) {
      n.say(side, "action", `${c.function.name}(${c.function.arguments})`);
      let content: string;
      try {
        const out = await exec(c.function.name, JSON.parse(c.function.arguments || "{}"));
        content = JSON.stringify(out);
        n.say(side, "result", content.slice(0, 240), out);
      } catch (err) {
        content = `error: ${(err as Error).message}`;
        n.say(side, "error", (err as Error).message);
      }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
  n.say(side, "done", "Stopped after max turns.");
  return { model: opts.model, turns: maxTurns, usage, outcome: "max_turns", costUsd: 0 };
}
