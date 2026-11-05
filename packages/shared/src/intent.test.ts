import { describe, expect, it } from "vitest";
import { canonicalize, hashIntent, worldActionFor, type PaymentIntent } from "./intent.ts";

const base: PaymentIntent = {
  v: 1,
  kind: "payment",
  agentId: "a1",
  nonce: "nonce-123456",
  createdAt: 1,
  expiresAt: 2,
  network: "hedera:testnet",
  asset: "0.0.429274",
  payTo: "0.0.777",
  amount: "5000000",
  resource: "https://api.example.com/x",
};

describe("intent hashing", () => {
  it("is independent of key order", () => {
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as PaymentIntent;
    expect(hashIntent(shuffled)).toBe(hashIntent(base));
  });
  it("changes when any field changes", () => {
    const h = hashIntent(base);
    expect(hashIntent({ ...base, amount: "5000001" })).not.toBe(h);
    expect(hashIntent({ ...base, payTo: "0.0.778" })).not.toBe(h);
    expect(hashIntent({ ...base, nonce: "nonce-123457" })).not.toBe(h);
  });
  it("canonical form has sorted keys and no spaces", () => {
    expect(canonicalize({ b: 1, a: [true, "x"] })).toBe('{"a":[true,"x"],"b":1}');
  });
  it("rejects floats", () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow();
  });
  it("world action is bound to the hash", () => {
    expect(worldActionFor(base)).toBe(`leash_pay_${hashIntent(base).slice(0, 32)}`);
  });
});
