/**
 * Live World ID check without a frontend: asks the server for signed request params, opens an
 * IDKit request from Node, prints the connect link for the World ID Simulator (staging), waits
 * for the proof and hands it to the server's verify endpoint (which calls developer.world.org).
 *
 *   API=http://localhost:4100/v1 npx tsx scripts/world-live-test.mts [enroll|login] [sessionId]
 */
import { setDefaultResultOrder } from "node:dns";
import { CredentialRequest, IDKit, proofOfHuman } from "@worldcoin/idkit-core";
setDefaultResultOrder("ipv4first");

const API = process.env.API ?? "http://localhost:4100/v1";
const mode = (process.argv[2] ?? "enroll") as "enroll" | "login";
const post = async (path: string, body: unknown) => {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j as any };
};

const p = (await post("/auth/world/request", { mode, ...(process.argv[3] ? { sessionId: process.argv[3] } : {}) })).body;
console.log(`server params: action=${p.action} env=${p.environment} session_id=${p.session_id}`);
const cfg: any = {
  app_id: p.app_id,
  rp_context: p.rp_context,
  environment: p.environment,
  action_description: p.action_description,
};
const builder = p.session_id === "create" || !p.session_id
  ? IDKit.request({ ...cfg, action: p.action, session_id: p.session_id, allow_legacy_proofs: false })
  : (IDKit as any).proveSession(p.session_id, cfg);
const isSession = !!p.session_id && p.session_id !== "create";
// Session proofs (login) take constraints; presets are only allowed on plain requests.
const req = isSession ? await builder.constraints(CredentialRequest("proof_of_human")) : await builder.preset(proofOfHuman());
console.log("\nOPEN THIS IN THE WORLD ID SIMULATOR (paste link / scan QR):\n" + req.connectorURI + "\n");
const out = await req.pollUntilCompletion({ timeout: 10 * 60_000 });
if (!out.success) { console.log("IDKit failed:", out.error, JSON.stringify(req.getDebugReport()).slice(0, 500)); process.exit(1); }
console.log("proof received from World App; result keys:", Object.keys(out.result));
const v = await post("/auth/world/verify", { mode, result: out.result });
console.log(`server verify -> HTTP ${v.status}`, JSON.stringify(v.body).slice(0, 400));
