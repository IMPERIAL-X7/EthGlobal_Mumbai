/**
 * Live end-to-end payment test on Hedera testnet (real x402 facilitator), no frontend needed:
 *   1. owner session (test DB row), create agent (real hot + vault accounts)
 *   2. fund the vault from the operator
 *   3. small payment  -> policy auto-approves -> paid from the HOT wallet
 *   4. large payment  -> pending -> owner approves with World ID (simulator link printed)
 *                      -> vault transfer co-signed by Leash (2-of-3) -> paid
 *
 *   DB=... API=http://localhost:4100/v1 MERCHANT=http://localhost:4210 npx tsx scripts/hedera-pay-test.mts <ownerId>
 * Asset is whatever the merchant charges in (HEDERA_USDC_TOKEN_ID=0.0.0 on the merchant -> HBAR).
 */
import { createHash, randomBytes } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { createRequire } from "node:module";
import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { CredentialRequest, IDKit } from "@worldcoin/idkit-core";
import { LeashAgent } from "../packages/agent-sdk/src/index.ts";
import { loadDotenv } from "../apps/server/src/config.ts";
setDefaultResultOrder("ipv4first");
loadDotenv();

const API = process.env.API ?? "http://localhost:4100/v1";
const MERCHANT = process.env.MERCHANT ?? "http://localhost:4210";
const ownerId = process.argv[2]!;
const Database = createRequire(new URL("../apps/server/package.json", import.meta.url))("better-sqlite3");
const token = "sid_test_" + randomBytes(16).toString("hex");
new Database(process.env.DB!)
  .prepare(`INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)`)
  .run(createHash("sha256").update(token).digest("hex"), ownerId, Math.floor(Date.now() / 1000) + 3600);
const owner = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", cookie: `leash_sid=${token}` }, body: b ? JSON.stringify(b) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const hashscan = (tx: string) => `https://hashscan.io/testnet/transaction/${tx}`;

// 1. agent
const c = await owner("POST", "/agents", { name: "pay-" + randomBytes(3).toString("hex") });
console.log(`agent ${c.agent.ens_name}: hot ${c.agent.hot_account}, vault ${c.agent.vault_account}`);

// 2. fund the vault (the hot wallet starts with 5 HBAR from account creation)
const op = Client.forTestnet().setOperator(AccountId.fromString(process.env.HEDERA_OPERATOR_ID!), PrivateKey.fromStringDer(process.env.HEDERA_OPERATOR_KEY!));
const fund = await (await new TransferTransaction().addHbarTransfer(process.env.HEDERA_OPERATOR_ID!, new Hbar(-1)).addHbarTransfer(c.agent.vault_account, new Hbar(1)).execute(op)).getReceipt(op);
console.log(`vault funded with 1 HBAR: ${fund.status}`);
op.close();

const agent = new LeashAgent({
  apiUrl: API,
  apiKey: c.secrets.apiKey,
  agentPrivateKey: c.secrets.agentPrivateKey,
  hotAccount: c.agent.hot_account,
  vaultAccount: c.agent.vault_account,
  log: (m) => console.log("  [agent]", m),
  approvalTimeoutSec: 600,
});

// Owner side: when Leash says "pending", get World params for that approval and print a simulator link.
const approver = {
  onDecision: async (d: { decision: string; approvalId?: string; reasons: string[] }) => {
    console.log(`  leash decision: ${d.decision}${d.reasons?.length ? ` (${d.reasons.join(", ")})` : ""}`);
    if (d.decision === "pending") console.log("  -> waiting for the owner: open http://localhost:4499 and approve with World ID");
  },
};
async function pay(label: string, path: string) {
  const t0 = Date.now();
  const r = await agent.fetch(`${MERCHANT}${path}`, {}, approver);
  const tx = JSON.parse(Buffer.from(r.headers.get("PAYMENT-RESPONSE")!, "base64").toString()).transaction;
  console.log(`${label} ${path} -> HTTP ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n  ${hashscan(tx)}\n`);
}

// 3. first payment to a new payee: policy requires the owner -> World ID -> paid from the VAULT (2-of-3)
await pay("PAYMENT 1 (new payee, owner approved, from vault)", "/forecast");
// 4. same payee again, under the auto limit: no human -> paid from the HOT wallet
await pay("PAYMENT 2 (known payee, automatic, from hot wallet)", "/forecast");
console.log("done");
