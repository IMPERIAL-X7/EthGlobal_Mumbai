/**
 * CO-SIGN VALIDATOR — the most security-critical code in Leash.
 *
 * The server holds one of the vault's 2-of-3 keys. It adds its signature to a transaction
 * ONLY if the parsed transaction does exactly what the human approved, and nothing else:
 *   - it is a plain TransferTransaction (not an account update, allowance, schedule, ...)
 *   - for a token payment: exactly two token transfers of the approved token:
 *       vault  -amount,  payTo  +amount
 *     and NO hbar transfers, NO nft transfers, NO other tokens
 *   - for an HBAR payment: exactly vault -amount / payTo +amount in hbar, nothing else
 *   - no "approved" (allowance) transfers
 *   - transaction id payer == expected fee payer (x402 facilitator) when one is given
 *   - valid-start inside a small window around now, and before the intent expires
 *
 * Everything else is refused. Fail closed.
 */
import { AccountId, Transaction, TransferTransaction, type PrivateKey } from "@hiero-ledger/sdk";

export interface ExpectedTransfer {
  vault: string; // payer account (0.0.x)
  payTo: string;
  asset: string; // "0.0.0" = HBAR, else HTS token id
  amount: string; // smallest units
  feePayer?: string; // facilitator account that pays fees / submits
  intentExpiresAt: number; // unix seconds
}

export class CosignRejected extends Error {}

const HBAR = "0.0.0";

function fail(msg: string): never {
  throw new CosignRejected(msg);
}

function asStr(id: unknown): string {
  return id instanceof AccountId ? id.toString() : String(id);
}

/** Collect transfers into plain arrays using the SDK's public maps. */
function readTransfers(tx: TransferTransaction) {
  const hbar: { account: string; amount: bigint; approved: boolean }[] = [];
  const token: { token: string; account: string; amount: bigint; approved: boolean }[] = [];

  // Hbar transfers (tinybars). Use the internal list to also see the isApproved flag.
  const hbarList: any[] = (tx as any)._hbarTransfers ?? [];
  for (const t of hbarList) {
    hbar.push({ account: asStr(t.accountId), amount: BigInt(t.amount.toTinybars().toString()), approved: !!t.isApproved });
  }
  const tokenList: any[] = (tx as any)._tokenTransfers ?? [];
  for (const t of tokenList) {
    token.push({ token: t.tokenId.toString(), account: asStr(t.accountId), amount: BigInt(t.amount.toString()), approved: !!t.isApproved });
  }
  const nftList: any[] = (tx as any)._nftTransfers ?? [];
  return { hbar, token, nftCount: nftList.length };
}

export function parseTx(bytes: Uint8Array): Transaction {
  try {
    return Transaction.fromBytes(bytes);
  } catch (e) {
    fail(`cannot parse transaction bytes: ${(e as Error).message}`);
  }
}

/** Validates and returns the parsed TransferTransaction. Throws CosignRejected on any mismatch. */
export function validateVaultTransfer(bytes: Uint8Array, exp: ExpectedTransfer, nowSec = Math.floor(Date.now() / 1000)): TransferTransaction {
  const tx = parseTx(bytes);
  if (!(tx instanceof TransferTransaction)) fail(`not a TransferTransaction (${tx.constructor.name})`);

  const { hbar, token, nftCount } = readTransfers(tx);
  if (nftCount > 0) fail("NFT transfers not allowed");
  if ([...hbar, ...token].some((t) => t.approved)) fail("allowance (approved) transfers not allowed");

  const amount = BigInt(exp.amount);
  if (amount <= 0n) fail("amount must be positive");

  const expectExactly = (list: { account: string; amount: bigint }[], label: string) => {
    if (list.length !== 2) fail(`${label}: expected exactly 2 transfers, got ${list.length}`);
    const debit = list.find((t) => t.account === exp.vault);
    const credit = list.find((t) => t.account === exp.payTo);
    if (!debit || debit.amount !== -amount) fail(`${label}: vault must be debited exactly ${amount}`);
    if (!credit || credit.amount !== amount) fail(`${label}: payee must be credited exactly ${amount}`);
    if (exp.vault === exp.payTo) fail("vault cannot pay itself");
  };

  if (exp.asset === HBAR) {
    if (token.length) fail("unexpected token transfers in an HBAR payment");
    expectExactly(hbar, "hbar");
  } else {
    if (hbar.length) fail("unexpected hbar transfers in a token payment");
    if (token.some((t) => t.token !== exp.asset)) fail("unexpected token in transfer");
    expectExactly(token, "token");
  }

  const txId = tx.transactionId;
  if (!txId || !txId.accountId || !txId.validStart) fail("transaction id missing");
  if (txId.scheduled) fail("scheduled transaction ids not allowed");
  if (exp.feePayer && txId.accountId.toString() !== exp.feePayer) {
    fail(`fee payer must be ${exp.feePayer}, got ${txId.accountId.toString()}`);
  }
  if (!exp.feePayer && txId.accountId.toString() !== exp.vault) {
    // Without a facilitator the vault itself pays fees — still nobody else.
    fail(`transaction payer must be the vault`);
  }

  const validStart = Number(txId.validStart.seconds.toString());
  if (validStart < nowSec - 120) fail("valid-start too far in the past");
  if (validStart > nowSec + 60) fail("valid-start too far in the future");
  if (validStart > exp.intentExpiresAt) fail("valid-start after intent expiry");

  return tx;
}

/** Validate, then add the server's signature. Returns signed bytes. */
export async function cosignVaultTransfer(bytes: Uint8Array, exp: ExpectedTransfer, serverKey: PrivateKey, nowSec?: number): Promise<Uint8Array> {
  const tx = validateVaultTransfer(bytes, exp, nowSec);
  await tx.sign(serverKey);
  return tx.toBytes();
}
