import { describe, expect, it } from "vitest";
import {
  AccountId,
  AccountUpdateTransaction,
  Hbar,
  PrivateKey,
  Timestamp,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { CosignRejected, cosignVaultTransfer, validateVaultTransfer, type ExpectedTransfer } from "./cosign.ts";

const NOW = 1_800_000_000;
const USDC = "0.0.429274";
const exp: ExpectedTransfer = {
  vault: "0.0.5001",
  payTo: "0.0.6001",
  asset: USDC,
  amount: "2500000",
  feePayer: "0.0.7162784",
  intentExpiresAt: NOW + 600,
};

type Tweak = (tx: TransferTransaction) => TransferTransaction;
function build(o: { payer?: string; validStart?: number; tweak?: Tweak; transfers?: Tweak } = {}): Uint8Array {
  let tx = new TransferTransaction();
  tx = o.transfers
    ? o.transfers(tx)
    : tx
        .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.vault), -2_500_000)
        .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.payTo), 2_500_000);
  if (o.tweak) tx = o.tweak(tx);
  tx.setTransactionId(
    TransactionId.withValidStart(AccountId.fromString(o.payer ?? exp.feePayer!), new Timestamp(o.validStart ?? NOW, 0)),
  ).setNodeAccountIds([new AccountId(3)]);
  return tx.freeze().toBytes();
}
const rejects = (bytes: Uint8Array, e: ExpectedTransfer = exp) =>
  expect(() => validateVaultTransfer(bytes, e, NOW)).toThrow(CosignRejected);

describe("co-sign validator", () => {
  it("accepts exactly the approved token payment", () => {
    expect(() => validateVaultTransfer(build(), exp, NOW)).not.toThrow();
  });

  it("signs and returns new bytes", async () => {
    const key = PrivateKey.generateECDSA();
    const signed = await cosignVaultTransfer(build(), exp, key, NOW);
    expect(signed.length).toBeGreaterThan(build().length);
  });

  it("rejects a different payee (approve Alice, pay attacker)", () => rejects(build(), { ...exp, payTo: "0.0.6002" }));
  it("rejects a different amount", () => rejects(build(), { ...exp, amount: "2500001" }));
  it("rejects a different token", () => rejects(build(), { ...exp, asset: "0.0.111" }));

  it("rejects an extra transfer to a third party", () =>
    rejects(
      build({
        transfers: (tx) =>
          tx
            .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.vault), -3_500_000)
            .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.payTo), 2_500_000)
            .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString("0.0.666"), 1_000_000),
      }),
    ));

  it("rejects a sneaky hbar transfer alongside the token payment", () =>
    rejects(build({ tweak: (tx) => tx.addHbarTransfer(AccountId.fromString(exp.vault), Hbar.fromTinybars(-5)).addHbarTransfer(AccountId.fromString("0.0.666"), Hbar.fromTinybars(5)) })));

  it("rejects allowance (approved) transfers", () =>
    rejects(
      build({
        transfers: (tx) =>
          tx
            .addApprovedTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.vault), -2_500_000)
            .addTokenTransfer(TokenId.fromString(USDC), AccountId.fromString(exp.payTo), 2_500_000),
      }),
    ));

  it("rejects the wrong fee payer", () => rejects(build({ payer: "0.0.999" })));
  it("rejects stale valid-start", () => rejects(build({ validStart: NOW - 600 })));
  it("rejects future valid-start", () => rejects(build({ validStart: NOW + 600 })));
  it("rejects valid-start after intent expiry", () => rejects(build(), { ...exp, intentExpiresAt: NOW - 1 }));

  it("rejects non-transfer transactions (e.g. changing the vault's key)", () => {
    const tx = new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(exp.vault))
      .setKey(PrivateKey.generateECDSA().publicKey)
      .setTransactionId(TransactionId.withValidStart(AccountId.fromString(exp.feePayer!), new Timestamp(NOW, 0)))
      .setNodeAccountIds([new AccountId(3)])
      .freeze();
    rejects(tx.toBytes());
  });

  it("rejects garbage bytes", () => rejects(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])));

  it("accepts an exact HBAR payment and rejects tokens in it", () => {
    const hbarExp = { ...exp, asset: "0.0.0", amount: "100000000" };
    const ok = build({
      transfers: (tx) =>
        tx.addHbarTransfer(AccountId.fromString(exp.vault), Hbar.fromTinybars(-100_000_000)).addHbarTransfer(AccountId.fromString(exp.payTo), Hbar.fromTinybars(100_000_000)),
    });
    expect(() => validateVaultTransfer(ok, hbarExp, NOW)).not.toThrow();
    rejects(build(), hbarExp);
  });
});
