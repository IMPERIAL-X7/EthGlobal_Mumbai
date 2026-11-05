/**
 * Agent identity on ENSv2 (Sepolia): every agent is `<name>.<parent>` with
 *   - an expiry  (agent time-to-live)
 *   - text records sellers can read: leash.status, leash.policy, leash.hedera.hot,
 *     leash.hedera.vault, leash.audit
 *   - unregister = revoke (name stops resolving)
 */
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Address, type Hex } from "viem";
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
// UNVERIFIED until spike S3: ABIs below are transcribed from docs.ens.domains/ensv2 and must be
// checked against the deployed contracts (docs.ens.domains/learn/deployments#sepolia-ensv2).

const userRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  { type: "function", name: "unregister", stateMutability: "nonpayable", inputs: [{ name: "anyId", type: "uint256" }], outputs: [] },
] as const;

const resolverAbi = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  { type: "function", name: "multicall", stateMutability: "nonpayable", inputs: [{ name: "data", type: "bytes[]" }], outputs: [{ type: "bytes[]" }] },
] as const;

export interface RealEnsConfig {
  rpcUrl: string;
  operatorPrivateKey: Hex;
  parent: string; // e.g. leash.eth (owned by operator)
  /** UserRegistry deployed for the parent (VerifiableFactory), and the PermissionedResolver used for records. */
  userRegistry: Address;
  resolver: Address;
  /** Role bitmap granted to the subname owner at registration (spike S3). */
  roleBitmap?: bigint;
}

export class RealNameService implements NameService {
  readonly mode = "real" as const;
  readonly parent: string;
  private pub;
  private wallet;
  private account;

  constructor(private cfg: RealEnsConfig) {
    this.parent = cfg.parent;
    this.account = privateKeyToAccount(cfg.operatorPrivateKey);
    this.pub = createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) });
    this.wallet = createWalletClient({ chain: sepolia, transport: http(cfg.rpcUrl), account: this.account });
  }

  fullName(label: string) {
    return `${label}.${this.parent}`;
  }

  private dnsName(name: string): Hex {
    return toHex(packetToBytes(normalize(name)));
  }

  private async send(fn: () => Promise<Hex>): Promise<Hex> {
    const hash = await fn();
    const rx = await this.pub.waitForTransactionReceipt({ hash });
    if (rx.status !== "success") throw new Error(`ENS tx reverted: ${hash}`);
    return hash;
  }

  async registerAgent(label: string, records: AgentRecords, expiresAt: number) {
    const txHash = await this.send(() =>
      this.wallet.writeContract({
        address: this.cfg.userRegistry,
        abi: userRegistryAbi,
        functionName: "register",
        args: [label, this.account.address, "0x0000000000000000000000000000000000000000", this.cfg.resolver, this.cfg.roleBitmap ?? 0n, BigInt(expiresAt)],
      }),
    );
    await this.setRecords(label, records);
    return { name: this.fullName(label), txHash };
  }

  async setRecords(label: string, records: AgentRecords) {
    const name = this.dnsName(this.fullName(label));
    const entries = Object.entries(records).filter(([, v]) => v !== undefined) as [keyof typeof LEASH_KEYS, string][];
    if (!entries.length) return {};
    const { encodeFunctionData } = await import("viem");
    const calls = entries.map(([k, v]) => encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [name, LEASH_KEYS[k], v] }));
    const txHash = await this.send(() =>
      this.wallet.writeContract({ address: this.cfg.resolver, abi: resolverAbi, functionName: "multicall", args: [calls] }),
    );
    return { txHash };
  }

  async revoke(label: string) {
    // anyId: ENSv2 accepts the label's token id / labelhash form (spike S3 to confirm).
    const anyId = BigInt(keccak256(toHex(label)));
    const txHash = await this.send(() =>
      this.wallet.writeContract({ address: this.cfg.userRegistry, abi: userRegistryAbi, functionName: "unregister", args: [anyId] }),
    );
    return { txHash };
  }

  async readRecords(name: string) {
    const out: AgentRecords & { exists: boolean } = { exists: false };
    for (const [k, key] of Object.entries(LEASH_KEYS) as [keyof typeof LEASH_KEYS, string][]) {
      const v = await this.pub.getEnsText({ name: normalize(name), key }).catch(() => null);
      if (v) {
        out[k] = v;
        out.exists = true;
      }
    }
    return out;
  }

  explorerUrl(name: string) {
    return `https://sepolia.app.ens.domains/${name}`;
  }
}
