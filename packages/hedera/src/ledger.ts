import {
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  KeyList,
  PrivateKey,
  PublicKey,
  ScheduleId,
  ScheduleInfoQuery,
  ScheduleSignTransaction,
  Transaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";

export interface AgentAccounts {
  hot: string;
  vault: string;
}
/** asset id -> balance in smallest units. "0.0.0" = HBAR (tinybars). */
export type Balances = Record<string, string>;

export interface ExpectedSettlement {
  from: string;
  to: string;
  asset: string;
  amount: string;
}
export interface Confirmation {
  ok: boolean;
  consensusAt?: string;
  error?: string;
}
export interface OutgoingTransfer {
  txId: string;
  to: string;
  asset: string;
  amount: string;
  consensusAt: string;
}

export interface Ledger {
  readonly mode: "real" | "fake";
  readonly serverPublicKey: string;
  explorerTxUrl(txId: string): string;
  createAgentAccounts(p: { agentPublicKey: string; ownerRecoveryPublicKey: string; initialHbar?: number }): Promise<AgentAccounts>;
  getBalances(account: string): Promise<Balances>;
  /** Confirm a settlement on chain (mirror node). Retries for mirror lag. */
  confirmTransfer(txId: string, exp: ExpectedSettlement): Promise<Confirmation>;
  /** Debits from `account` after `sinceConsensus` (seconds.nanos) — used to detect hot-wallet bypass. */
  outgoingTransfers(account: string, sinceConsensus: string): Promise<OutgoingTransfer[]>;
  /** Fetch a scheduled tx, run `validate` on its inner transaction, then add the server signature. */
  signSchedule(scheduleId: string, validate: (inner: Transaction) => void): Promise<string>;
}

/** Convert SDK tx id "0.0.123@1700000000.000000123" -> mirror format "0.0.123-1700000000-000000123". */
export function toMirrorTxId(txId: string): string {
  const [acct, ts] = txId.split("@");
  if (!acct || !ts) return txId;
  const [s, n = "0"] = ts.split(".");
  return `${acct}-${s}-${n.padStart(9, "0")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RealLedgerConfig {
  network: "testnet" | "mainnet";
  operatorId: string;
  operatorKey: string;
  serverCosignKey: string;
  mirrorUrl: string;
}

export class RealLedger implements Ledger {
  readonly mode = "real" as const;
  readonly client: Client;
  private serverKey: PrivateKey;
  readonly serverPublicKey: string;

  constructor(private cfg: RealLedgerConfig) {
    this.client = cfg.network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    this.client.setOperator(AccountId.fromString(cfg.operatorId), PrivateKey.fromStringDer(cfg.operatorKey));
    this.serverKey = PrivateKey.fromStringDer(cfg.serverCosignKey);
    this.serverPublicKey = this.serverKey.publicKey.toStringDer();
  }

  getServerKey(): PrivateKey {
    return this.serverKey;
  }

  explorerTxUrl(txId: string): string {
    return `https://hashscan.io/${this.cfg.network}/transaction/${toMirrorTxId(txId)}`;
  }

  async createAgentAccounts(p: { agentPublicKey: string; ownerRecoveryPublicKey: string; initialHbar?: number }): Promise<AgentAccounts> {
    const agentKey = PublicKey.fromString(p.agentPublicKey);
    const ownerKey = PublicKey.fromString(p.ownerRecoveryPublicKey);
    const hbar = new Hbar(p.initialHbar ?? 5);

    const hotRx = await (
      await new AccountCreateTransaction()
        .setKeyWithoutAlias(agentKey)
        .setInitialBalance(hbar)
        .setMaxAutomaticTokenAssociations(10)
        .setAccountMemo("leash hot wallet")
        .execute(this.client)
    ).getReceipt(this.client);

    // Vault: 2-of-3 threshold key {agent, server, owner-recovery}. No single party can move funds.
    const vaultKey = new KeyList([agentKey, this.serverKey.publicKey, ownerKey], 2);
    const vaultRx = await (
      await new AccountCreateTransaction()
        .setKeyWithoutAlias(vaultKey)
        .setInitialBalance(hbar)
        .setMaxAutomaticTokenAssociations(10)
        .setAccountMemo("leash vault (2-of-3)")
        .execute(this.client)
    ).getReceipt(this.client);

    return { hot: hotRx.accountId!.toString(), vault: vaultRx.accountId!.toString() };
  }

  private async mirror(path: string): Promise<any> {
    const res = await fetch(`${this.cfg.mirrorUrl}${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`mirror ${res.status} for ${path}`);
    return res.json();
  }

  async getBalances(account: string): Promise<Balances> {
    const d = await this.mirror(`/api/v1/accounts/${account}`);
    const out: Balances = { "0.0.0": String(d?.balance?.balance ?? 0) };
    for (const t of d?.balance?.tokens ?? []) out[t.token_id] = String(t.balance);
    return out;
  }

  async confirmTransfer(txId: string, exp: ExpectedSettlement): Promise<Confirmation> {
    const id = toMirrorTxId(txId);
    for (let attempt = 0; attempt < 8; attempt++) {
      const d = await this.mirror(`/api/v1/transactions/${id}`).catch(() => null);
      const tx = d?.transactions?.[0];
      if (tx) {
        if (tx.result !== "SUCCESS") return { ok: false, error: `result ${tx.result}` };
        const list: { account: string; amount: number | string }[] =
          exp.asset === "0.0.0" ? tx.transfers ?? [] : (tx.token_transfers ?? []).filter((t: any) => t.token_id === exp.asset);
        const sum = (acct: string) => list.filter((t) => t.account === acct).reduce((a, t) => a + BigInt(t.amount), 0n);
        const amt = BigInt(exp.amount);
        // For HBAR the payer side also includes fees when it is the fee payer, so require "at least".
        const debitOk = exp.asset === "0.0.0" ? sum(exp.from) <= -amt : sum(exp.from) === -amt;
        if (!debitOk || sum(exp.to) !== amt) return { ok: false, error: "transfer does not match intent" };
        return { ok: true, consensusAt: tx.consensus_timestamp };
      }
      await sleep(1500);
    }
    return { ok: false, error: "not found on mirror node (timeout)" };
  }

  async outgoingTransfers(account: string, sinceConsensus: string): Promise<OutgoingTransfer[]> {
    const d = await this.mirror(`/api/v1/transactions?account.id=${account}&type=debit&order=asc&limit=50&timestamp=gt:${sinceConsensus}`);
    const out: OutgoingTransfer[] = [];
    for (const tx of d?.transactions ?? []) {
      if (tx.result !== "SUCCESS" || tx.name !== "CRYPTOTRANSFER") continue;
      for (const t of tx.token_transfers ?? []) {
        if (BigInt(t.amount) > 0n && t.account !== account) {
          out.push({ txId: tx.transaction_id, to: t.account, asset: t.token_id, amount: String(t.amount), consensusAt: tx.consensus_timestamp });
        }
      }
      const debit = (tx.transfers ?? []).find((t: any) => t.account === account && BigInt(t.amount) < 0n);
      const credits = (tx.transfers ?? []).filter((t: any) => t.account !== account && BigInt(t.amount) > 0n && !/^0\.0\.\d{1,3}$/.test(t.account) && t.account !== "0.0.98");
      if (debit) for (const c of credits) out.push({ txId: tx.transaction_id, to: c.account, asset: "0.0.0", amount: String(c.amount), consensusAt: tx.consensus_timestamp });
    }
    return out;
  }

  async signSchedule(scheduleId: string, validate: (inner: Transaction) => void): Promise<string> {
    const info = await new ScheduleInfoQuery().setScheduleId(ScheduleId.fromString(scheduleId)).execute(this.client);
    const inner = info.scheduledTransaction;
    validate(inner);
    const tx = await new ScheduleSignTransaction().setScheduleId(ScheduleId.fromString(scheduleId)).freezeWith(this.client).sign(this.serverKey);
    const resp = await tx.execute(this.client);
    await resp.getReceipt(this.client);
    return resp.transactionId.toString();
  }
}

/** Validate that a scheduled refill is exactly vault -> hot of an allowed amount. */
export function validateRefill(inner: Transaction, exp: { vault: string; hot: string; asset: string; maxAmount: bigint }): bigint {
  if (!(inner instanceof TransferTransaction)) throw new Error("refill must be a TransferTransaction");
  const hbar: any[] = (inner as any)._hbarTransfers ?? [];
  const token: any[] = (inner as any)._tokenTransfers ?? [];
  const nft: any[] = (inner as any)._nftTransfers ?? [];
  if (nft.length) throw new Error("no NFTs in refills");
  const list =
    exp.asset === "0.0.0"
      ? hbar.map((t) => ({ a: t.accountId.toString(), v: BigInt(t.amount.toTinybars().toString()), ok: !t.isApproved }))
      : token.map((t) => ({ a: t.accountId.toString(), v: BigInt(t.amount.toString()), ok: !t.isApproved && t.tokenId.toString() === exp.asset }));
  if ((exp.asset === "0.0.0" ? token.length : hbar.length) > 0) throw new Error("mixed assets in refill");
  if (list.length !== 2 || list.some((t) => !t.ok)) throw new Error("refill must be exactly vault -> hot");
  const debit = list.find((t) => t.a === exp.vault);
  const credit = list.find((t) => t.a === exp.hot);
  if (!debit || !credit || debit.v !== -credit.v || credit.v <= 0n) throw new Error("refill must be exactly vault -> hot");
  if (credit.v > exp.maxAmount) throw new Error(`refill ${credit.v} exceeds allowed ${exp.maxAmount}`);
  return credit.v;
}
