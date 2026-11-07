/**
 * Live ENS check against a running server with real chains: create an agent, wait for its ENS
 * records, read them back through the public Universal Resolver (as a merchant would), revoke, re-read.
 *   DB=... API=http://localhost:4100/v1 npx tsx scripts/ens-live-test.mts <ownerId>
 */
import { createHash, randomBytes } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createRequire } from "node:module";
import { RealNameService } from "../packages/ens/src/index.ts";
import { loadDotenv } from "../apps/server/src/config.ts";
setDefaultResultOrder("ipv4first");
loadDotenv();
const API = process.env.API ?? "http://localhost:4100/v1";
const Database = createRequire(new URL("../apps/server/package.json", import.meta.url))("better-sqlite3");
const token = "sid_test_" + randomBytes(16).toString("hex");
new Database(process.env.DB!).prepare(`INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`).run(createHash("sha256").update(token).digest("hex"), process.argv[2], Math.floor(Date.now() / 1000) + 3600);
const owner = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", cookie: `leash_sid=${token}` }, body: b ? JSON.stringify(b) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
// Reader only: any key works for reads, we never write with it here.
const ens = new RealNameService({ rpcUrl: process.env.SEPOLIA_RPC_URL!, operatorPrivateKey: process.env.ENS_OPERATOR_PRIVATE_KEY!, parent: process.env.ENS_PARENT_NAME ?? "leash.eth", resolver: process.env.ENS_RESOLVER as any });
const waitFor = async (name: string, ok: (r: any) => boolean, what: string) => {
  const t0 = Date.now();
  for (;;) {
    const r = await ens.readRecords(name);
    if (ok(r)) return console.log(`${what} after ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(r));
    if (Date.now() - t0 > 120_000) throw new Error(`${what}: timed out, last ${JSON.stringify(r)}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
};
const t0 = Date.now();
const c = await owner("POST", "/agents", { name: "ens-" + randomBytes(3).toString("hex") });
console.log(`created ${c.agent.ens_name} in ${((Date.now() - t0) / 1000).toFixed(1)}s (hot ${c.agent.hot_account}, vault ${c.agent.vault_account})`);
await waitFor(c.agent.ens_name, (r) => r.exists && r.hot === c.agent.hot_account, "resolves publicly");
await owner("POST", `/agents/${c.agent.id}/revoke`);
await waitFor(c.agent.ens_name, (r) => r.status === "revoked" && !r.exists, "after revoke");
console.log(`https://sepolia.app.ens.domains/${c.agent.ens_name}`);
