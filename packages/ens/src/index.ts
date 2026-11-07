/**
 * Agent identity on ENSv2 (Sepolia): every agent is `<name>.<parent>` with
 *   - an expiry  (agent time-to-live)
 *   - text records sellers can read: leash.status, leash.policy, leash.hedera.hot,
 *     leash.hedera.vault, leash.audit
 *   - unregister = revoke (name stops resolving)
 */
import { createPublicClient, createWalletClient, encodeFunctionData, http, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize, packetToBytes } from "viem/ens";

export const LEASH_KEYS = {
  status: "leash.status",
  policy: "leash.policy",
  hot: "leash.hedera.hot",
  vault: "leash.hedera.vault",
  audit: "leash.audit",
  owner: "leash.owner", // opaque owner id (never the World nullifier)
} as const;

export type AgentRecords = Partial<Record<keyof typeof LEASH_KEYS, string>>;

export interface NameService {
  readonly mode: "real" | "fake";
  readonly parent: string;
  fullName(label: string): string;
  registerAgent(label: string, records: AgentRecords, expiresAt: number): Promise<{ name: string; txHash?: string }>;
  setRecords(label: string, records: AgentRecords): Promise<{ txHash?: string }>;
  revoke(label: string): Promise<{ txHash?: string }>;
  readRecords(name: string): Promise<AgentRecords & { exists: boolean }>;
  explorerUrl(name: string): string;
}

// ---------------- fake ----------------
export class FakeNameService implements NameService {
  readonly mode = "fake" as const;
  private names = new Map<string, { records: AgentRecords; expiresAt: number }>();
  constructor(readonly parent = "leash.eth") {}
  fullName(label: string) {
    return `${label}.${this.parent}`;
  }
  async registerAgent(label: string, records: AgentRecords, expiresAt: number) {
    const name = this.fullName(label);
    if (this.names.has(name)) throw new Error(`name taken: ${name}`);
    this.names.set(name, { records: { ...records }, expiresAt });
    return { name };
  }
  async setRecords(label: string, records: AgentRecords) {
    const n = this.names.get(this.fullName(label));
    if (!n) throw new Error("unknown name");
    Object.assign(n.records, records);
    return {};
  }
  async revoke(label: string) {
    this.names.delete(this.fullName(label));
    return {};
  }
  async readRecords(name: string) {
    const n = this.names.get(name);
    if (!n || n.expiresAt < Date.now() / 1000) return { exists: false };
    return { exists: true, ...n.records };
  }
  explorerUrl(name: string) {
    return `#fake-ens/${name}`;
  }
}

// ---------------- real (ENSv2, Sepolia) ----------------
// Verified live on Sepolia (Nov 6) with scripts/setup-ens.ts: the operator owns <parent> on the ENSv2
// ETHRegistry and its resolver is our own PermissionedResolver. Agents are NOT separate registry
// entries: each agent is `<label>.<parent>` whose text records live on that resolver, and ENSv2's
// Universal Resolver finds them by wildcard (ENSIP-10). One tx per agent, and the parent owner
// (Leash) is the only writer, so an agent can never edit its own identity.

import { PermissionedResolverImplAbi } from "./ensv2.ts";
export { ENSV2_SEPOLIA } from "./ensv2.ts";

/** Extra record (beyond LEASH_KEYS): unix expiry of the agent identity. */
const EXPIRES_KEY = "leash.expires";

export interface RealEnsConfig {
  rpcUrl: string;
  /** Hex private key, with or without 0x. Owns <parent> and holds text roles on the resolver. */
  operatorPrivateKey: string;
  parent: string; // e.g. leash.eth
  /** Our PermissionedResolver (ENS_RESOLVER, written by scripts/setup-ens.ts). */
  resolver: Address;
}

export class RealNameService implements NameService {
  readonly mode = "real" as const;
  readonly parent: string;
  private pub;
  private wallet;
  private account;
  /** One operator account => serialize writes so concurrent updates don't race on the nonce. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private cfg: RealEnsConfig) {
    this.parent = cfg.parent;
    const pk = cfg.operatorPrivateKey.startsWith("0x") ? cfg.operatorPrivateKey : `0x${cfg.operatorPrivateKey}`;
    this.account = privateKeyToAccount(pk as Hex);
    this.pub = createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ chain: sepolia, transport: http(cfg.rpcUrl), account: this.account });
  }

  fullName(label: string) {
    return `${label}.${this.parent}`;
  }

  private dnsName(name: string): Hex {
    return toHex(packetToBytes(normalize(name)));
  }

  private writeTexts(label: string, kv: [string, string][]): Promise<{ txHash?: Hex }> {
    if (!kv.length) return Promise.resolve({});
    const name = this.dnsName(this.fullName(label));
    const run = async () => {
      const calls = kv.map(([k, v]) => encodeFunctionData({ abi: PermissionedResolverImplAbi, functionName: "setText", args: [name, k, v] }));
      const hash = await this.wallet.writeContract({ address: this.cfg.resolver, abi: PermissionedResolverImplAbi, functionName: "multicall", args: [calls] });
      const rx = await this.pub.waitForTransactionReceipt({ hash });
      if (rx.status !== "success") throw new Error(`ENS tx reverted: ${hash}`);
      return { txHash: hash };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async registerAgent(label: string, records: AgentRecords, expiresAt: number) {
    const kv = Object.entries(records)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [LEASH_KEYS[k as keyof typeof LEASH_KEYS], v!] as [string, string]);
    const { txHash } = await this.writeTexts(label, [...kv, [EXPIRES_KEY, String(expiresAt)]]);
    return { name: this.fullName(label), txHash };
  }

  setRecords(label: string, records: AgentRecords) {
    const kv = Object.entries(records)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [LEASH_KEYS[k as keyof typeof LEASH_KEYS], v!] as [string, string]);
    return this.writeTexts(label, kv);
  }

  /** Revoke = status "revoked" and the wallet records cleared, in one tx. Sellers must check status. */
  revoke(label: string) {
    return this.writeTexts(label, [
      [LEASH_KEYS.status, "revoked"],
      [LEASH_KEYS.hot, ""],
      [LEASH_KEYS.vault, ""],
      [EXPIRES_KEY, "0"],
    ]);
  }

  async readRecords(name: string) {
    const out: AgentRecords & { exists: boolean } = { exists: false };
    const keys = Object.entries(LEASH_KEYS) as [keyof typeof LEASH_KEYS, string][];
    const [vals, exp] = await Promise.all([
      Promise.all(keys.map(([, key]) => this.pub.getEnsText({ name: normalize(name), key }).catch(() => null))),
      this.pub.getEnsText({ name: normalize(name), key: EXPIRES_KEY }).catch(() => null),
    ]);
    keys.forEach(([k], i) => {
      if (vals[i]) out[k] = vals[i]!;
    });
    const expired = exp != null && Number(exp) < Date.now() / 1000;
    out.exists = !!out.status && out.status !== "revoked" && !expired;
    return out;
  }

  explorerUrl(name: string) {
    return `https://sepolia.app.ens.domains/${name}`;
  }
}
