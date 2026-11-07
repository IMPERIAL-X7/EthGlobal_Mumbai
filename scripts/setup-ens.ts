/**
 * One-time ENSv2 (Sepolia) setup. Needs SEPOLIA_RPC_URL + ENS_OPERATOR_PRIVATE_KEY (funded with
 * Sepolia ETH) and ENS_PARENT_NAME (e.g. leash.eth). Safe to re-run: finished steps are skipped.
 *
 *   1. deploy our own PermissionedResolver (VerifiableFactory proxy), operator holds text/addr roles
 *   2. register <parent> on the ENSv2 ETHRegistrar (commit -> wait -> register, paid in MockUSDC)
 *      with that resolver; if we already own it, just point it at the resolver
 *   3. smoke test: write a record for setup-check.<parent> and read it back via the Universal Resolver
 *
 * Agents are then <label>.<parent> records on that resolver (ENSIP-10 wildcard): one tx per agent,
 * no per-agent registration. Writes ENS_RESOLVER to .env.
 *
 *   npx tsx scripts/setup-ens.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, toHex, zeroAddress, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize, packetToBytes } from "viem/ens";
import { loadDotenv } from "../apps/server/src/config.ts";
import {
  ENSV2_SEPOLIA as A,
  ETHRegistrarAbi,
  ETHRegistryAbi,
  MockUSDCAbi,
  PermissionedResolverImplAbi,
  ROLE_SET_ADDRESS,
  ROLE_SET_TEXT,
  VerifiableFactoryAbi,
  adminOf,
} from "../packages/ens/src/ensv2.ts";
setDefaultResultOrder("ipv4first");

const ENV_PATH = resolve(process.cwd(), ".env");
loadDotenv(ENV_PATH);
function setEnv(key: string, value: string) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`;
  writeFileSync(ENV_PATH, text);
  process.env[key] = value;
  console.log(`  wrote ${key}=${value}`);
}

const pk = process.env.ENS_OPERATOR_PRIVATE_KEY!;
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
const transport = http(process.env.SEPOLIA_RPC_URL);
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });
const parent = process.env.ENS_PARENT_NAME ?? "leash.eth";
const label = parent.replace(/\.eth$/, "");
if (label.includes(".")) throw new Error("ENS_PARENT_NAME must be a 2LD like leash.eth");
const dns = (name: string) => toHex(packetToBytes(normalize(name)));

async function send(what: string, p: Promise<Hex>) {
  const hash = await p;
  const rx = await pub.waitForTransactionReceipt({ hash });
  if (rx.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  console.log(`  ${what}: https://sepolia.etherscan.io/tx/${hash}`);
  return rx;
}

console.log(`operator ${account.address}, ${Number(await pub.getBalance({ address: account.address })) / 1e18} ETH; parent ${parent}`);

// ---- 1. resolver
let resolver = process.env.ENS_RESOLVER as Hex | undefined;
if (!resolver) {
  const roles = ROLE_SET_TEXT | ROLE_SET_ADDRESS | adminOf(ROLE_SET_TEXT) | adminOf(ROLE_SET_ADDRESS);
  const init = encodeFunctionData({ abi: PermissionedResolverImplAbi, functionName: "initialize", args: [[{ account: account.address, roleBitmap: roles }], []] });
  const salt = BigInt(keccak256(toHex(`leash-resolver:${parent}:${account.address}`)));
  const { result } = await pub.simulateContract({ account, address: A.VerifiableFactory, abi: VerifiableFactoryAbi, functionName: "deployProxy", args: [A.PermissionedResolverImpl, salt, init] });
  const code = await pub.getCode({ address: result });
  if (!code) await send("deploy resolver", wallet.writeContract({ address: A.VerifiableFactory, abi: VerifiableFactoryAbi, functionName: "deployProxy", args: [A.PermissionedResolverImpl, salt, init] }));
  resolver = result;
  setEnv("ENS_RESOLVER", resolver);
} else console.log(`resolver ${resolver} (from .env)`);

// ---- 2. parent name
const tokenId = await pub.readContract({ address: A.ETHRegistry, abi: ETHRegistryAbi, functionName: "getTokenId", args: [BigInt(keccak256(toHex(label)))] });
const owner = await pub.readContract({ address: A.ETHRegistry, abi: ETHRegistryAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => zeroAddress);
if (owner.toLowerCase() === account.address.toLowerCase()) {
  const cur = await pub.readContract({ address: A.ETHRegistry, abi: ETHRegistryAbi, functionName: "getResolver", args: [label] });
  console.log(`${parent} already ours; resolver ${cur}`);
  if (cur.toLowerCase() !== resolver.toLowerCase()) await send("setResolver", wallet.writeContract({ address: A.ETHRegistry, abi: ETHRegistryAbi, functionName: "setResolver", args: [tokenId, resolver] }));
} else {
  const available = await pub.readContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "isAvailable", args: [label] });
  if (!available) throw new Error(`${parent} is taken on ENSv2 Sepolia (owner ${owner}). Set ENS_PARENT_NAME to another name and re-run.`);
  const duration = 365n * 24n * 3600n;
  const [base, premium] = await pub.readContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "getRegisterPrice", args: [label, duration, A.MockUSDC] });
  const price = base + premium;
  console.log(`registering ${parent} for 1 year, price ${Number(price) / 1e6} MockUSDC`);
  const bal = await pub.readContract({ address: A.MockUSDC, abi: MockUSDCAbi, functionName: "balanceOf", args: [account.address] });
  if (bal < price) await send("mint MockUSDC", wallet.writeContract({ address: A.MockUSDC, abi: MockUSDCAbi, functionName: "mint", args: [account.address, price - bal + 1_000_000n] }));
  await send("approve", wallet.writeContract({ address: A.MockUSDC, abi: MockUSDCAbi, functionName: "approve", args: [A.ETHRegistrar, price] }));
  const secret = keccak256(toHex(`leash:${Date.now()}:${Math.random()}`));
  const commitment = await pub.readContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "makeCommitment", args: [label, account.address, secret, zeroAddress, resolver, duration, zeroHash] });
  await send("commit", wallet.writeContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "commit", args: [commitment] }));
  const age = await pub.readContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" });
  console.log(`  waiting ${Number(age) + 15}s (commit-reveal)...`);
  await new Promise((r) => setTimeout(r, (Number(age) + 15) * 1000));
  await send("register", wallet.writeContract({ address: A.ETHRegistrar, abi: ETHRegistrarAbi, functionName: "register", args: [label, account.address, secret, zeroAddress, resolver, duration, A.MockUSDC, zeroHash] }));
}

// ---- 3. smoke test through the Universal Resolver (what any wallet / merchant would do)
const probe = `setup-check.${parent}`;
const value = `ok ${new Date().toISOString()}`;
await send(`setText ${probe}`, wallet.writeContract({ address: resolver, abi: PermissionedResolverImplAbi, functionName: "setText", args: [dns(probe), "leash.status", value] }));
const got = await pub.getEnsText({ name: normalize(probe), key: "leash.status" });
console.log(`read back via Universal Resolver: ${JSON.stringify(got)} ${got === value ? "✅" : "❌ (expected " + value + ")"}`);
console.log(`\nhttps://sepolia.app.ens.domains/${parent}`);
