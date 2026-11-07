/**
 * Read-only sanity check of the chain keys in .env. Prints no secrets.
 *   npx tsx scripts/check-keys.ts
 */
import { setDefaultResultOrder } from "node:dns";
import { PrivateKey } from "@hiero-ledger/sdk";
import { createPublicClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { loadDotenv } from "../apps/server/src/config.ts";
setDefaultResultOrder("ipv4first");
loadDotenv();
const env = process.env;
const ok = (b: boolean) => (b ? "✅" : "❌");

// ---- Hedera
try {
  const id = env.HEDERA_OPERATOR_ID!;
  const key = PrivateKey.fromStringDer(env.HEDERA_OPERATOR_KEY!);
  const r = await fetch(`${env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com"}/api/v1/accounts/${id}`);
  const a: any = await r.json();
  if (!r.ok) throw new Error(`mirror ${r.status}: ${JSON.stringify(a).slice(0, 200)}`);
  const onChain = String(a.key?.key ?? "").toLowerCase();
  const mine = key.publicKey.toStringRaw().toLowerCase();
  console.log(`Hedera operator ${id}: exists ✅  key type ${a.key?._type}  balance ${(a.balance.balance / 1e8).toFixed(2)} HBAR ${ok(a.balance.balance > 20e8)}`);
  console.log(`  .env key matches the account's on-chain key: ${ok(onChain === mine)}`);
} catch (e) {
  console.log("Hedera ❌", (e as Error).message);
}

// ---- Sepolia / ENS
try {
  const pk = (env.ENS_OPERATOR_PRIVATE_KEY!.startsWith("0x") ? env.ENS_OPERATOR_PRIVATE_KEY! : `0x${env.ENS_OPERATOR_PRIVATE_KEY}`) as `0x${string}`;
  const acct = privateKeyToAccount(pk);
  const c = createPublicClient({ chain: sepolia, transport: http(env.SEPOLIA_RPC_URL) });
  const [chainId, bal, block] = await Promise.all([c.getChainId(), c.getBalance({ address: acct.address }), c.getBlockNumber()]);
  console.log(`Sepolia RPC: chainId ${chainId} ${ok(chainId === 11155111)}  latest block ${block}`);
  console.log(`ENS operator ${acct.address}: ${formatEther(bal)} ETH ${ok(bal > 10n ** 16n)} (want ≥ 0.01)`);
} catch (e) {
  console.log("Sepolia ❌", (e as Error).message.slice(0, 300));
}
