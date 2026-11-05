/**
 * One-time Hedera testnet setup. Needs HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY in .env
 * (free testnet account from portal.hedera.com). Creates what's missing and writes it to .env:
 *   - LEASH_SERVER_COSIGN_KEY   (server's share of every vault; NOT the operator key)
 *   - HCS_AUDIT_TOPIC_ID        (immutable: no admin key)
 *   - MERCHANT_ACCOUNT_ID / MERCHANT_PRIVATE_KEY, ATTACKER_ACCOUNT_ID (demo accounts)
 *
 * Run:  npm run setup:hedera
 * Safe to re-run: existing values are kept.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AccountCreateTransaction, AccountId, Client, Hbar, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import { loadDotenv } from "../apps/server/src/config.ts";

const ENV_PATH = resolve(process.cwd(), ".env");
loadDotenv(ENV_PATH);

function setEnv(key: string, value: string) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
  writeFileSync(ENV_PATH, text);
  process.env[key] = value;
  console.log(`  wrote ${key}`);
}

async function main() {
  const { HEDERA_OPERATOR_ID: opId, HEDERA_OPERATOR_KEY: opKey } = process.env;
  if (!opId || !opKey) throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env first (see docs/KEYS.md §2)");

  const client = Client.forTestnet().setOperator(AccountId.fromString(opId), PrivateKey.fromStringDer(opKey));
  console.log(`operator ${opId} on testnet`);

  if (!process.env.LEASH_SERVER_COSIGN_KEY) {
    setEnv("LEASH_SERVER_COSIGN_KEY", PrivateKey.generateECDSA().toStringDer());
  }

  if (!process.env.HCS_AUDIT_TOPIC_ID) {
    const rx = await (
      await new TopicCreateTransaction()
        .setTopicMemo("Leash audit log v1 — agent spending decisions")
        .setSubmitKey(PrivateKey.fromStringDer(opKey).publicKey) // only Leash can write; nobody can edit or delete
        .execute(client)
    ).getReceipt(client);
    setEnv("HCS_AUDIT_TOPIC_ID", rx.topicId!.toString());
  }

  const newAccount = async (memo: string, hbar: number) => {
    const key = PrivateKey.generateECDSA();
    const rx = await (
      await new AccountCreateTransaction().setKeyWithoutAlias(key.publicKey).setInitialBalance(new Hbar(hbar)).setMaxAutomaticTokenAssociations(10).setAccountMemo(memo).execute(client)
    ).getReceipt(client);
    return { id: rx.accountId!.toString(), key: key.toStringDer() };
  };

  if (!process.env.MERCHANT_ACCOUNT_ID) {
    const m = await newAccount("leash demo merchant (Weather Pro)", 5);
    setEnv("MERCHANT_ACCOUNT_ID", m.id);
    setEnv("MERCHANT_PRIVATE_KEY", m.key);
  }
  if (!process.env.ATTACKER_ACCOUNT_ID) {
    const a = await newAccount("leash demo attacker", 1);
    setEnv("ATTACKER_ACCOUNT_ID", a.id);
  }

  client.close();
  console.log(`
done. Next:
  1. Get testnet USDC (token 0.0.429274) from https://faucet.circle.com into your agent's hot/vault
     accounts after creating an agent (both auto-associate tokens).
  2. Topic: https://hashscan.io/testnet/topic/${process.env.HCS_AUDIT_TOPIC_ID}
  3. Restart the server — /v1/health should show hedera: "real".`);
}

main().catch((e) => {
  console.error("setup failed:", e.message ?? e);
  process.exit(1);
});
