/**
 * Minimal MCP stdio server exposing the demo agent's tools, so `claude -p` (Claude Code on the
 * user's own Pro/Max subscription) can be the agent. Spawned by claude-cli.ts; not run by hand.
 *
 * Env: LEASH_MCP_SIDE=legacy|leash, LEGACY_URL, MERCHANT_URL, LEASH_AGENT_CONFIG (JSON, leash side)
 */
import { LeashAgent } from "@leash/agent-sdk";
import { Narrator, type Side } from "./narrator.ts";
import { makeExecutor, toolSpecs } from "./toolset.ts";

console.log = console.error; // stdout is the JSON-RPC channel

const side = (process.env.LEASH_MCP_SIDE ?? "legacy") as Side;
const endpoints = {
  legacyUrl: process.env.LEGACY_URL ?? "http://localhost:4300",
  merchantUrl: process.env.MERCHANT_URL ?? "http://localhost:4200",
};
const leash = side === "leash" ? new LeashAgent(JSON.parse(process.env.LEASH_AGENT_CONFIG ?? "{}")) : undefined;
const exec = makeExecutor(side, endpoints, new Narrator(), leash);

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(req: { id?: number | string; method: string; params?: any }) {
  const reply = (result: unknown) => req.id !== undefined && send({ jsonrpc: "2.0", id: req.id, result });
  switch (req.method) {
    case "initialize":
      return reply({
        protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "wallet", version: "0.1.0" },
      });
    case "tools/list":
      return reply({ tools: toolSpecs(side).map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) });
    case "tools/call":
      try {
        const out = await exec(req.params.name, req.params.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    case "ping":
      return reply({});
    default:
      if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } });
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) void handle(JSON.parse(line));
  }
});
