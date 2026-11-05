/**
 * Full-stack rehearsal (fake chains). Assumes these are running:
 *   LEASH_FAKE_CHAINS=1 npm run dev     (:4000)   MERCHANT_FAKE=1 npm run merchant (:4200)
 *   npm run legacy                      (:4300)   npm run agent                    (:4400)
 *
 * Plays the owner: enrolls, creates an agent, hands its credentials to the runner, starts both
 * sides, then approves the premium invoice and denies everything else (like a human would).
 */
const API = process.env.LEASH_API_URL ?? "http://localhost:4000/v1";
const AGENT = process.env.AGENT_RUNNER_URL ?? "http://localhost:4400";
let cookie = "";

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0]!;
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const sessionId = `session_rehearsal_${Date.now()}`;
const proof = (action?: string) => call("POST", `${API}/dev/world-proof`, { action, sessionId });

await call("POST", `${API}/auth/world/verify`, { mode: "enroll", result: await proof("leash_enroll") });
const created = await call("POST", `${API}/agents`, { name: `demo-${Date.now().toString(36)}` });
console.log(`agent ${created.agent.ens_name}  hot=${created.agent.hot_account} vault=${created.agent.vault_account}`);
await call("POST", `${AGENT}/configure`, {
  apiKey: created.secrets.apiKey,
  agentPrivateKey: created.secrets.agentPrivateKey,
  hotAccount: created.agent.hot_account,
  vaultAccount: created.agent.vault_account,
});
await call("POST", `${AGENT}/run`, { side: "both", mode: "scripted" });

const seen = new Set<string>();
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  const status = await call("GET", `${AGENT}/status`);
  for (const ap of await call("GET", `${API}/approvals?status=pending`)) {
    if (seen.has(ap.id)) continue;
    seen.add(ap.id);
    await new Promise((r) => setTimeout(r, 1500)); // "human reads the screen"
    if (ap.kind === "payment" && ap.summary.includes("report/premium")) {
      console.log(`👤 APPROVE  ${ap.summary}`);
      await call("POST", `${API}/approvals/${ap.id}/verify`, { result: await proof(ap.worldAction) });
    } else {
      console.log(`👤 DENY     ${ap.summary}  ${ap.warnings.join(" | ")}`);
      await call("POST", `${API}/approvals/${ap.id}/deny`);
    }
  }
  if (status.running.length === 0 && seen.size > 0) break;
  await new Promise((r) => setTimeout(r, 700));
}

const detail = await call("GET", `${API}/agents/${created.agent.id}`);
const act = await call("GET", `${API}/agents/${created.agent.id}/activity`);
console.log("\nLeash activity:");
for (const a of act.reverse()) console.log(`  ${a.decision.padEnd(14)} ${a.status.padEnd(10)} ${a.source ?? ""}\t${a.summary}`);
console.log("balances:", JSON.stringify(detail.balances));
console.log("policy version:", detail.policy.version, "(1 = the agent did NOT manage to raise its limits)");
const audit = await call("GET", `${API}/agents/${created.agent.id}/audit`);
console.log(`audit events: ${audit.events.length}`);

export {};
