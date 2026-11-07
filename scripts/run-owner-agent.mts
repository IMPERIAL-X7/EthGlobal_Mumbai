/**
 * Plays the owner's agent for the live demo, using the .env file downloaded from the "keys" screen.
 * Funds the vault from the operator (testnet HBAR), then buys from the demo merchant twice:
 *   1. first payment to a new shop -> waits for the owner's World ID approval (approve it in the web app)
 *   2. same shop again, small      -> automatic from the everyday wallet
 * Never prints the keys.
 *
 *   npx tsx scripts/run-owner-agent.mts ~/Downloads/shopper.env [merchantUrl]
 */
import { readFileSync } from "node:fs";
import { setDefaultResultOrder } from "node:dns";
import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@hiero-ledger/sdk";
import { LeashAgent, LeashDenied } from "../packages/agent-sdk/src/index.ts";
import { loadDotenv } from "../apps/server/src/config.ts";
setDefaultResultOrder("ipv4first");
loadDotenv();

const file = process.argv[2]!;
// Default: the live deployment's demo shop if the keys came from the live site, else the local shop.
const cfg = Object.fromEntries(
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
// The keys file holds the web app's /v1 (proxied to the server). Local dev: talk to :4000 directly.
const fileApi = cfg.LEASH_API_URL ?? "";
const local = /localhost|127\.0\.0\.1/.test(fileApi);
const apiUrl = process.env.LEASH_DIRECT_API ?? (local ? "http://localhost:4000/v1" : fileApi);
const MERCHANT = process.argv[3] ?? (local ? "http://localhost:4210" : fileApi.replace(/\/v1$/, "/shop"));
console.log(`agent: hot ${cfg.AGENT_HOT_ACCOUNT_ID}, vault ${cfg.AGENT_VAULT_ACCOUNT_ID} → ${apiUrl}, shop ${MERCHANT}`);

const op = Client.forTestnet().setOperator(AccountId.fromString(process.env.HEDERA_OPERATOR_ID!), PrivateKey.fromStringDer(process.env.HEDERA_OPERATOR_KEY!));
const rx = await (await new TransferTransaction().addHbarTransfer(process.env.HEDERA_OPERATOR_ID!, new Hbar(-1)).addHbarTransfer(cfg.AGENT_VAULT_ACCOUNT_ID!, new Hbar(1)).execute(op)).getReceipt(op);
console.log(`vault funded with 1 test HBAR: ${rx.status}`);
op.close();

const agent = new LeashAgent({
  apiUrl,
  apiKey: cfg.LEASH_AGENT_API_KEY!,
  agentPrivateKey: cfg.AGENT_ACCOUNT_KEY!,
  hotAccount: cfg.AGENT_HOT_ACCOUNT_ID!,
  vaultAccount: cfg.AGENT_VAULT_ACCOUNT_ID!,
  approvalTimeoutSec: 600,
  log: (m) => console.log("  [agent]", m),
});

async function pay(label: string, path: string) {
  console.log(`\n${label}: GET ${MERCHANT}${path}`);
  try {
    const r = await agent.fetch(`${MERCHANT}${path}`, {}, {
      onDecision: (d) => d.decision === "pending" && console.log("  >>> WAITING FOR YOU: open the web app and approve with World ID (10 min)"),
    });
    const pr = r.headers.get("PAYMENT-RESPONSE");
    if (!pr) {
      const body: any = await r.json().catch(() => ({}));
      return console.log(`  REFUSED by the shop, HTTP ${r.status}: ${body.message ?? body.error ?? ""}`);
    }
    const tx = JSON.parse(Buffer.from(pr, "base64").toString()).transaction;
    console.log(`  paid, HTTP ${r.status}: https://hashscan.io/testnet/transaction/${tx}`);
  } catch (e) {
    console.log(`  not paid: ${e instanceof LeashDenied ? `${e.message}` : (e as Error).message}`);
  }
}

await pay("PAYMENT 1 (new shop, needs you)", "/forecast");
await pay("PAYMENT 2 (same shop, automatic)", "/forecast");
console.log("\ndone");
