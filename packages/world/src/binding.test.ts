import { describe, expect, it } from "vitest";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { checkBinding } from "./index.ts";

const A = "leash_pol_bc2b28e1367b66115369d677d632e6c4";
const session = (signal?: string) => ({
  protocol_version: "4.0",
  session_id: "session_abc",
  responses: [{ session_nullifier: ["123", "456"], ...(signal ? { signal_hash: hashSignal(signal) } : {}) }],
});

describe("checkBinding", () => {
  it("accepts a session proof whose signal is this approval", () => {
    expect(checkBinding(session(A), { action: A, signal: A }, "staging")).toMatchObject({ action: A, nullifier: "123", sessionId: "session_abc" });
  });
  it("rejects a session proof made for a different approval", () => {
    expect(() => checkBinding(session("leash_pol_other"), { action: A, signal: A }, "staging")).toThrow(/signal mismatch/);
  });
  it("rejects a session proof with no signal when a binding is required", () => {
    expect(() => checkBinding(session(), { action: A, signal: A }, "staging")).toThrow(/not bound/);
    expect(() => checkBinding(session(), { action: A }, "staging")).toThrow(/not bound/);
  });
  it("still checks the action on uniqueness proofs", () => {
    const u = { action: "leash_enroll", session_id: "session_abc", responses: [{ nullifier: "7" }] };
    expect(checkBinding(u, { action: "leash_enroll" }, "staging").action).toBe("leash_enroll");
    expect(() => checkBinding(u, { action: A }, "staging")).toThrow(/action mismatch/);
  });
  it("login (no binding asked) accepts a plain session proof", () => {
    expect(checkBinding(session(), {}, "staging").sessionId).toBe("session_abc");
  });
});
