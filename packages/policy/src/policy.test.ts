import { describe, expect, it } from "vitest";
import { defaultPolicy, type PaymentIntent } from "@leash/shared";
import { evaluate, type SpendState } from "./index.ts";

const now = 1_800_000_000;
const intent = (o: Partial<PaymentIntent> = {}): PaymentIntent => ({
  v: 1,
  kind: "payment",
  agentId: "a1",
  nonce: "nonce-123456",
  createdAt: now,
  expiresAt: now + 600,
  network: "hedera:testnet",
  asset: "0.0.429274",
  payTo: "0.0.777",
  amount: "50000",
  resource: "https://api.example.com/x",
  ...o,
});
const state = (o: Partial<SpendState> = {}): SpendState => ({
  agentStatus: "active",
  autoSpentToday: "0",
  hotBalance: "1000000",
  knownPayee: true,
  pendingApprovals: 0,
  now,
  ...o,
});
const p = defaultPolicy(); // auto 0.10, daily 1.00, hard 50

describe("policy.evaluate", () => {
  it("auto-pays small known payments", () => {
    expect(evaluate(intent(), p, state()).kind).toBe("AUTO_HOT");
  });
  it("boundary: exactly the per-payment limit is auto", () => {
    expect(evaluate(intent({ amount: "100000" }), p, state()).kind).toBe("AUTO_HOT");
  });
  it("one unit above per-payment limit needs approval", () => {
    expect(evaluate(intent({ amount: "100001" }), p, state()).kind).toBe("NEEDS_APPROVAL");
  });
  it("daily budget exhaustion needs approval", () => {
    const d = evaluate(intent({ amount: "60000" }), p, state({ autoSpentToday: "950000" }));
    expect(d.kind).toBe("NEEDS_APPROVAL");
    expect(d.reasons).toContain("would exceed daily auto budget");
  });
  it("new payee needs approval unless allowlisted", () => {
    expect(evaluate(intent(), p, state({ knownPayee: false })).kind).toBe("NEEDS_APPROVAL");
    expect(evaluate(intent(), { ...p, allowlist: ["0.0.777"] }, state({ knownPayee: false })).kind).toBe("AUTO_HOT");
  });
  it("low hot balance needs approval (vault path)", () => {
    expect(evaluate(intent(), p, state({ hotBalance: "10" })).kind).toBe("NEEDS_APPROVAL");
  });
  it.each([
    ["paused agent", intent(), state({ agentStatus: "paused" })],
    ["revoked agent", intent(), state({ agentStatus: "revoked" })],
    ["hard max", intent({ amount: "50000001" }), state()],
    ["blocked asset", intent({ asset: "0.0.999" }), state()],
    ["expired intent", intent({ expiresAt: now }), state()],
    ["cooldown", intent({ amount: "5000000" }), state({ payeeCooldownUntil: now + 10 })],
  ])("denies: %s", (_n, i, s) => {
    expect(evaluate(i, p, s).kind).toBe("DENY");
  });
  it("denies blocklisted payee even if tiny", () => {
    expect(evaluate(intent({ amount: "1" }), { ...p, blocklist: ["0.0.777"] }, state()).kind).toBe("DENY");
  });
  it("caps pending approvals (anti-spam) but never blocks auto payments", () => {
    expect(evaluate(intent({ amount: "200000" }), p, state({ pendingApprovals: 3 })).kind).toBe("DENY");
    expect(evaluate(intent(), p, state({ pendingApprovals: 3 })).kind).toBe("AUTO_HOT");
  });
  it("warns on first-time payee", () => {
    expect(evaluate(intent(), p, state({ knownPayee: false })).warnings).toContain("First time paying this address");
  });
});
