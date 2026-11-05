import { PrivateKey, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import type { AgentAccounts, Balances, Confirmation, ExpectedSettlement, Ledger, OutgoingTransfer } from "./ledger.ts";

interface FakeTx {
  txId: string;
  consensusAt: string;
  transfers: { account: string; asset: string; amount: bigint }[];
}

/**
 * In-memory Hedera for offline dev, tests and frontend work (LEASH_FAKE_CHAINS=1).
 * Uses real SDK transaction bytes, so the co-sign path is exercised exactly as on testnet.
 * NOTE: signatures are not checked here — the real network does that.
 */
export class FakeLedger implements Ledger {
  readonly mode = "fake" as const;
  readonly serverPublicKey: string;
  private next = 9000;
  private balances = new Map<string, Map<string, bigint>>();
  private txs: FakeTx[] = [];
  private clock = 0;

  constructor(private serverKey: PrivateKey = PrivateKey.generateECDSA()) {
    this.serverPublicKey = serverKey.publicKey.toStringDer();
  }
  getServerKey(): PrivateKey {
    return this.serverKey;
  }

  explorerTxUrl(txId: string): string {
    return `#fake-tx/${encodeURIComponent(txId)}`;
  }

  private bal(account: string): Map<string, bigint> {
    let b = this.balances.get(account);
    if (!b) this.balances.set(account, (b = new Map()));
    return b;
  }

  async createAgentAccounts(): Promise<AgentAccounts> {
    const hot = `0.0.${this.next++}`;
    const vault = `0.0.${this.next++}`;
    this.bal(hot).set("0.0.0", 500_000_000n);
    this.bal(vault).set("0.0.0", 500_000_000n);
    return { hot, vault };
  }

  devFund(account: string, asset: string, amount: string): void {
    const b = this.bal(account);
    b.set(asset, (b.get(asset) ?? 0n) + BigInt(amount));
  }

  /** Acts like facilitator settle / network execution: applies a TransferTransaction. */
  async devSubmit(bytes: Uint8Array): Promise<string> {
    const tx = Transaction.fromBytes(bytes);
    if (!(tx instanceof TransferTransaction)) throw new Error("fake ledger only executes transfers");
    const transfers = [
      ...((tx as any)._hbarTransfers ?? []).map((t: any) => ({ account: t.accountId.toString(), asset: "0.0.0", amount: BigInt(t.amount.toTinybars().toString()) })),
      ...((tx as any)._tokenTransfers ?? []).map((t: any) => ({ account: t.accountId.toString(), asset: t.tokenId.toString(), amount: BigInt(t.amount.toString()) })),
    ];
    return this.apply(transfers, tx.transactionId!.toString());
  }

  apply(transfers: FakeTx["transfers"], txId?: string): string {
    for (const t of transfers) {
      if (t.amount < 0n && (this.bal(t.account).get(t.asset) ?? 0n) < -t.amount) throw new Error(`INSUFFICIENT_BALANCE ${t.account}`);
    }
    for (const t of transfers) {
      const b = this.bal(t.account);
      b.set(t.asset, (b.get(t.asset) ?? 0n) + t.amount);
    }
    const consensusAt = `${Math.floor(Date.now() / 1000)}.${String(++this.clock).padStart(9, "0")}`;
    const id = txId ?? `0.0.2@${consensusAt}`;
    this.txs.push({ txId: id, consensusAt, transfers });
    return id;
  }

  async getBalances(account: string): Promise<Balances> {
    const out: Balances = { "0.0.0": "0" };
    for (const [a, v] of this.bal(account)) out[a] = v.toString();
    return out;
  }

  async confirmTransfer(txId: string, exp: ExpectedSettlement): Promise<Confirmation> {
    const tx = this.txs.find((t) => t.txId === txId);
    if (!tx) return { ok: false, error: "unknown tx" };
    const sum = (a: string) => tx.transfers.filter((t) => t.account === a && t.asset === exp.asset).reduce((x, t) => x + t.amount, 0n);
    if (sum(exp.from) !== -BigInt(exp.amount) || sum(exp.to) !== BigInt(exp.amount)) return { ok: false, error: "transfer does not match intent" };
    return { ok: true, consensusAt: tx.consensusAt };
  }

  async outgoingTransfers(account: string, since: string): Promise<OutgoingTransfer[]> {
    const out: OutgoingTransfer[] = [];
    for (const tx of this.txs) {
      if (Number(tx.consensusAt) <= Number(since)) continue;
      if (!tx.transfers.some((t) => t.account === account && t.amount < 0n)) continue;
      for (const t of tx.transfers) if (t.account !== account && t.amount > 0n) out.push({ txId: tx.txId, to: t.account, asset: t.asset, amount: t.amount.toString(), consensusAt: tx.consensusAt });
    }
    return out;
  }

  async signSchedule(): Promise<string> {
    throw new Error("scheduled refills: use devApplyRefill in fake mode");
  }
}
