/**
 * LLM mode: a real Claude agent with the same tools on each side. Manual tool loop so every
 * tool call is narrated to the demo screen as it happens.
 *
 * Note: the Nov 2026 paper found Claude Opus models did NOT self-escalate on the legacy wallet
 * (smaller open models did). So in LLM mode the legacy side may behave well — that is a real
 * result, not a bug. Use scripted mode for the guaranteed side-by-side.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { LeashAgent } from "@leash/agent-sdk";
import type { Narrator, Side } from "./narrator.ts";
import { SYSTEM_PROMPT, makeExecutor, toolSpecs, type LlmRunResult, type RunOpts } from "./toolset.ts";
import type { Endpoints } from "./tools.ts";

export type { LlmRunResult } from "./toolset.ts";

const MODEL = process.env.AGENT_MODEL || "claude-opus-5-5";

type Tool = Anthropic.Beta.BetaTool;
const anthropicTools = (side: Side): Tool[] =>
  toolSpecs(side).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters, strict: true }));

export async function runLlm(side: Side, task: string, e: Endpoints, n: Narrator, leash?: LeashAgent, opts: RunOpts = {}): Promise<LlmRunResult> {
  const model = opts.model ?? MODEL;
  const maxTurns = opts.maxTurns ?? 12;
  const usage = { input: 0, output: 0, cacheRead: 0 };
  const client = new Anthropic(); // ANTHROPIC_API_KEY
  const exec = makeExecutor(side, e, n, leash);
  const tools = anthropicTools(side);

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: task }];
  n.say(side, "info", `LLM mode (${model}) — task: ${task}`);

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a declined request is re-run server-side on Anthropic's recommended fallback
      output_config: { effort: "medium" },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    if (response.stop_reason === "refusal") {
      n.say(side, "error", `Model declined (${response.stop_details?.category ?? "unknown"}).`);
      return { model, turns: turn + 1, usage, outcome: "refusal" };
    }
    // Append the full content (thinking blocks included) — the history stays append-only.
    messages.push({ role: "assistant", content: response.content });

    for (const b of response.content) if (b.type === "text" && b.text.trim()) n.say(side, "thought", b.text.trim());
    if (response.stop_reason === "pause_turn") continue;

    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) {
      if (response.stop_reason === "max_tokens") n.say(side, "error", "Ran out of output tokens.");
      n.say(side, "done", "Agent finished.");
      return { model, turns: turn + 1, usage, outcome: "done" };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const c of calls) {
      n.say(side, "action", `${c.name}(${JSON.stringify(c.input)})`);
      try {
        const out = await exec(c.name, c.input);
        n.say(side, "result", JSON.stringify(out).slice(0, 240), out);
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
      } catch (err) {
        n.say(side, "error", (err as Error).message);
        results.push({ type: "tool_result", tool_use_id: c.id, content: (err as Error).message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  n.say(side, "done", "Stopped after max turns.");
  return { model, turns: maxTurns, usage, outcome: "max_turns" };
}
