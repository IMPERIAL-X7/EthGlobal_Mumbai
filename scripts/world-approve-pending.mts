/**
 * Tiny local approval page for live World ID tests. Open http://localhost:4499 WHEN YOU ARE READY:
 * each page load creates a FRESH World request for the newest pending approval (World requests
 * expire after ≤5 min, so links must be minted on demand, exactly like the real Approve button).
 *   DB=... API=http://localhost:4100/v1 npx tsx scripts/world-approve-pending.mts <ownerId>
 * Test DB only: it signs in by writing a session row (real login is tested by world-live-test.mts).
 */
import { createHash, randomBytes } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { CredentialRequest, IDKit } from "@worldcoin/idkit-core";
setDefaultResultOrder("ipv4first");

const API = process.env.API ?? "http://localhost:4100/v1";
const Database = createRequire(new URL("../apps/server/package.json", import.meta.url))("better-sqlite3");
const token = "sid_test_" + randomBytes(16).toString("hex");
new Database(process.env.DB!)
  .prepare(`INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`)
  .run(createHash("sha256").update(token).digest("hex"), process.argv[2], Math.floor(Date.now() / 1000) + 3600);
const owner = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", cookie: `leash_sid=${token}` }, body: b ? JSON.stringify(b) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};

const log: string[] = [];
const say = (m: string) => {
  log.push(`${new Date().toLocaleTimeString()}  ${m}`);
  console.log(m);
};

async function freshRequest() {
  const pending = await owner("GET", "/approvals?status=pending");
  const ap = (Array.isArray(pending) ? pending : (pending.approvals ?? []))[0];
  if (!ap) return null;
  const p = await owner("POST", `/approvals/${ap.id}/world-request`);
  const req = await (IDKit as any)
    .proveSession(p.session_id, { app_id: p.app_id, rp_context: p.rp_context, environment: p.environment, action_description: p.action_description })
    .constraints(CredentialRequest("proof_of_human", { signal: p.signal }));
  const ttl = p.rp_context.expires_at - Math.floor(Date.now() / 1000);
  say(`new link for ${ap.id} (valid ${ttl}s): ${p.action_description}`);
  void req.pollUntilCompletion({ timeout: ttl * 1000 + 30_000 }).then(async (out: any) => {
    if (!out.success) return say(`World failed: ${out.error} ${String(req.getDebugReport().response_payload ?? "")}`);
    try {
      const v = await owner("POST", `/approvals/${ap.id}/verify`, { result: out.result });
      say(`APPROVED with World ID -> ${v.status}`);
    } catch (e) {
      say(`verify rejected: ${(e as Error).message}`);
    }
  });
  return { p, url: req.connectorURI as string, ttl };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
createServer(async (q, res) => {
  if (q.url !== "/") return void res.writeHead(404).end();
  let body: string;
  try {
    const r = await freshRequest();
    body = r
      ? `<h2>${esc(r.p.action_description)}</h2><p>Valid for ${r.ttl}s. Copy this into the World ID Simulator (same identity):</p>
         <textarea id=u rows=3 style="width:100%">${esc(r.url)}</textarea>
         <button onclick="navigator.clipboard.writeText(u.value);this.textContent='Copied'">Copy link</button>
         <p><a href="https://simulator.worldcoin.org" target=_blank>Open simulator</a> · reload this page for a fresh link if it expires</p>`
      : `<h2>No pending approval right now.</h2>`;
  } catch (e) {
    body = `<h2>Error</h2><pre>${esc((e as Error).message)}</pre>`;
  }
  res
    .writeHead(200, { "content-type": "text/html; charset=utf-8" })
    .end(`<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px">${body}<h3>Log</h3><pre>${esc(log.join("\n"))}</pre></body>`);
}).listen(4499, () => console.log("approval page: http://localhost:4499"));
