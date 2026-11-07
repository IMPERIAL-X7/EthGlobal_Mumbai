/**
 * Live World ID check of the approval gate (no frontend needed):
 *   1. signs in as an existing owner by writing a session row into the (test) DB
 *   2. creates an agent; the agent asks to raise its own limit -> pending approval
 *   3. owner gets signed World params for that approval, IDKit prints a connect link
 *   4. you approve in the World ID Simulator; the proof goes to POST /approvals/:id/verify
 *   5. checks the policy really changed, then replays the same proof (must be rejected)
 *
 *   DB=/path/to/test.db API=http://localhost:4100/v1 npx tsx scripts/world-approval-test.mts <ownerId>
 *
 * Only for a throwaway test DB: step 1 bypasses login on purpose (login is tested by world-live-test.mts).
 */
import { createHash, randomBytes } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createRequire } from "node:module";
import { CredentialRequest, IDKit } from "@worldcoin/idkit-core";
setDefaultResultOrder("ipv4first");

const API = process.env.API ?? "http://localhost:4100/v1";
const DB = process.env.DB!;
const ownerId = process.argv[2]!;
if (!DB || !ownerId) throw new Error("usage: DB=... npx tsx scripts/world-approval-test.mts <ownerId>");

const Database = createRequire(new URL("../apps/server/package.json", import.meta.url))("better-sqlite3");
const token = "sid_test_" + randomBytes(16).toString("hex");
new Database(DB)
  .prepare(`INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`)
  .run(createHash("sha256").update(token).digest("hex"), ownerId, Math.floor(Date.now() / 1000) + 3600);

async function call(method: string, path: string, body?: unknown, auth: Record<string, string> = { cookie: `leash_sid=${token}` }) {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...auth }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

const me = await call("GET", "/me");
if (me.status !== 200) throw new Error(`session not accepted: ${me.status} ${JSON.stringify(me.body)}`);
const name = "wtest-" + randomBytes(3).toString("hex");
const created = await call("POST", "/agents", { name });
if (created.status !== 201) throw new Error(`create agent: ${created.status} ${JSON.stringify(created.body)}`);
const agentId = created.body.agent.id;
const apiKey = created.body.secrets.apiKey;
const before = (await call("GET", `/agents/${agentId}`)).body.policy;
console.log(`agent ${name} (${agentId}) policy v${before.version}: autoPerPayment=${before.policy.autoPerPayment}`);

const wanted = { ...before.policy, autoPerPayment: String(Number(before.policy.autoPerPayment) * 10) };
const pr = await call("POST", "/agent/policy-requests", { policy: wanted, reason: "world live test" }, { authorization: `Bearer ${apiKey}` });
if (pr.status !== 202) throw new Error(`policy request: ${pr.status} ${JSON.stringify(pr.body)}`);
console.log(`agent asked to raise its limit -> approval ${pr.body.approvalId}: ${pr.body.summary}`);

const p = (await call("POST", `/approvals/${pr.body.approvalId}/world-request`)).body;
console.log(`approval params: action=${p.action} signal=${p.signal} session=${String(p.session_id).slice(0, 16)}… env=${p.environment}`);
const req = await (IDKit as any)
  .proveSession(p.session_id, { app_id: p.app_id, rp_context: p.rp_context, environment: p.environment, action_description: p.action_description })
  // Session proofs carry no action: the approval is bound through the signal the server handed us.
  .constraints(CredentialRequest("proof_of_human", { signal: p.signal }));
console.log("\nOPEN THIS IN THE WORLD ID SIMULATOR (same identity you enrolled with):\n" + req.connectorURI + "\n");
const out = await req.pollUntilCompletion({ timeout: 10 * 60_000 });
if (!out.success) { console.log("IDKit failed:", out.error); process.exit(1); }
const r0 = (out.result as any).responses?.[0] ?? {};
console.log(`proof received: session=${String((out.result as any).session_id).slice(0, 16)}… action=${(out.result as any).action} signal_hash=${r0.signal_hash}`);

const v = await call("POST", `/approvals/${pr.body.approvalId}/verify`, { result: out.result });
console.log(`verify -> HTTP ${v.status} ${JSON.stringify(v.body).slice(0, 300)}`);
const after = (await call("GET", `/agents/${agentId}`)).body.policy;
console.log(`policy now v${after.version}: autoPerPayment=${after.policy.autoPerPayment} (${after.version > before.version ? "CHANGED by human approval" : "unchanged"})`);

// Replay: the same proof against a NEW approval must be refused.
const pr2 = await call("POST", "/agent/policy-requests", { policy: { ...wanted, autoPerPayment: String(Number(wanted.autoPerPayment) * 10) }, reason: "replay test" }, { authorization: `Bearer ${apiKey}` });
const replay = await call("POST", `/approvals/${pr2.body.approvalId}/verify`, { result: out.result });
console.log(`replay of same proof on a new approval -> HTTP ${replay.status} ${JSON.stringify(replay.body).slice(0, 200)} (${replay.status >= 400 ? "REJECTED, good" : "ACCEPTED, BAD"})`);
