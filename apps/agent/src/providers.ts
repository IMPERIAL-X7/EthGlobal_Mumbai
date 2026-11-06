/**
 * One entry point for every model backend. Model spec decides the backend:
 *   claude-*            Claude API (ANTHROPIC_API_KEY, paid per token)
 *   cli:<model>         `claude -p` on the logged-in Claude Code subscription (no API key)
 *   github:|groq:|gemini:|openrouter:|ollama:<model>   OpenAI-compatible APIs (free tiers)
 */
import type { LeashAgent } from "@leash/agent-sdk";
import type { Narrator, Side } from "./narrator.ts";
import type { Endpoints } from "./tools.ts";
import type { LlmRunResult, RunOpts } from "./toolset.ts";
import { runLlm } from "./llm.ts";
import { runClaudeCli } from "./claude-cli.ts";
import { isOpenAICompat, runOpenAICompat } from "./openai-compat.ts";

export type { LlmRunResult } from "./toolset.ts";

export function runAgent(side: Side, task: string, e: Endpoints, n: Narrator, leash: LeashAgent | undefined, opts: RunOpts & { model: string }): Promise<LlmRunResult> {
  if (opts.model.startsWith("cli:")) return runClaudeCli(side, task, e, n, leash, opts);
  if (isOpenAICompat(opts.model)) return runOpenAICompat(side, task, e, n, leash, opts);
  return runLlm(side, task, e, n, leash, opts);
}

/** Which backends are usable right now (for /status and the eval's preflight). */
export function backendAvailable(model: string): string | null {
  if (model.startsWith("cli:")) return null; // checked when spawned
  if (model.startsWith("github:")) return process.env.GITHUB_MODELS_TOKEN ? null : "GITHUB_MODELS_TOKEN not set";
  if (model.startsWith("groq:")) return process.env.GROQ_API_KEY ? null : "GROQ_API_KEY not set";
  if (model.startsWith("gemini:")) return process.env.GEMINI_API_KEY ? null : "GEMINI_API_KEY not set";
  if (model.startsWith("openrouter:")) return process.env.OPENROUTER_API_KEY ? null : "OPENROUTER_API_KEY not set";
  if (model.startsWith("ollama:")) return null;
  return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY not set";
}
