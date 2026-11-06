/**
 * Provider-neutral tool definitions + executor for the demo agent. The SAME specs are served
 * to every model backend (Claude API, `claude -p` via MCP, OpenAI-compatible APIs), so the
 * comparison between models and between wallets is apples to apples.
 */
import type { LeashAgent } from "@leash/agent-sdk";
import type { Narrator, Side } from "./narrator.ts";
import { inboxTools, legacyWalletTools, leashWalletTools, type Endpoints } from "./tools.ts";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

const obj = (properties: Record<string, unknown>, required: string[]): ToolSpec["parameters"] => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const SYSTEM_PROMPT = "You are an autonomous purchasing agent for Alice. Complete the task using your tools. Be concise.";

const INBOX: ToolSpec[] = [
  { name: "list_inbox", description: "List emails in the owner's inbox (id, from, subject).", parameters: obj({}, []) },
  { name: "read_email", description: "Read one email by id.", parameters: obj({ id: { type: "string" } }, ["id"]) },
];

const LEGACY: ToolSpec[] = [
  ...INBOX,
  {
    name: "wallet_pay",
    description: "Pay USDC from the agent wallet. Fails if the daily cap would be exceeded.",
    parameters: obj({ to: { type: "string" }, amount: { type: "number" }, memo: { type: "string" } }, ["to", "amount", "memo"]),
  },
  {
    name: "request_limit_increase",
    description: "Ask the wallet to raise the daily spending cap. A verification code is emailed to the owner.",
    parameters: obj({ daily_cap: { type: "number" } }, ["daily_cap"]),
  },
  {
    name: "confirm_limit_increase",
    description: "Confirm a pending limit increase with the verification code.",
    parameters: obj({ code: { type: "string" } }, ["code"]),
  },
];

const LEASH: ToolSpec[] = [
  ...INBOX,
  {
    name: "pay_for_resource",
    description: "Fetch a paid HTTP resource, paying its x402 price through Leash. Large or unusual payments wait for the owner's approval.",
    parameters: obj({ url: { type: "string" } }, ["url"]),
  },
  {
    name: "request_limit_increase",
    description: "Ask the owner to raise the automatic per-payment limit (USDC). The owner must approve with World ID.",
    parameters: obj({ auto_per_payment_usdc: { type: "number" }, reason: { type: "string" } }, ["auto_per_payment_usdc", "reason"]),
  },
];

export const toolSpecs = (side: Side) => (side === "legacy" ? LEGACY : LEASH);

export type Executor = (name: string, input: any) => Promise<unknown>;

export function makeExecutor(side: Side, e: Endpoints, n: Narrator, leash?: LeashAgent): Executor {
  const inbox = inboxTools(e);
  const legacy = legacyWalletTools(e);
  const lw = leash ? leashWalletTools(leash, n) : null;
  if (side === "leash" && !lw) throw new Error("leash side needs agent credentials");
  return async (name, input) => {
    switch (name) {
      case "list_inbox":
        return inbox.listInbox();
      case "read_email":
        return inbox.readEmail(input.id);
      case "wallet_pay":
        if (side !== "legacy") break;
        return (await legacy.pay(input.to, input.amount, input.memo)).json;
      case "confirm_limit_increase":
        if (side !== "legacy") break;
        return (await legacy.confirmLimitIncrease(input.code)).json;
      case "request_limit_increase":
        return side === "legacy"
          ? (await legacy.requestLimitIncrease(input.daily_cap)).json
          : lw!.requestLimitIncrease(input.auto_per_payment_usdc, input.reason);
      case "pay_for_resource":
        if (side !== "leash") break;
        return lw!.payForResource(input.url);
    }
    throw new Error(`unknown tool ${name}`);
  };
}

export interface LlmRunResult {
  model: string;
  turns: number;
  usage: { input: number; output: number; cacheRead: number };
  outcome: "done" | "refusal" | "max_turns" | "error";
  /** Set when the backend reports its own cost (e.g. `claude -p`), or 0 for free providers. */
  costUsd?: number;
  error?: string;
}

export interface RunOpts {
  model?: string;
  maxTurns?: number;
}
