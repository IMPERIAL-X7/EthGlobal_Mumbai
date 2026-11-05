import type { DecisionKind, PaymentIntent, Policy } from "@leash/shared";

export interface SpendState {
  agentStatus: "active" | "paused" | "revoked";
  /** Automatic (hot wallet) spend so far today, same asset, smallest units. */
  autoSpentToday: string;
  /** Hot wallet balance of the intent's asset. */
  hotBalance: string;
  /** Has this agent ever completed a payment to intent.payTo? */
  knownPayee: boolean;
  pendingApprovals: number;
  /** Unix seconds until which this payee is in deny-cooldown, if any. */
  payeeCooldownUntil?: number;
  now: number;
}

export interface Decision {
  kind: DecisionKind;
  reasons: string[];
  warnings: string[];
}

/**
 * Pure, deterministic policy evaluation. No I/O, no clocks (time comes in via state.now).
 * DENY rules are checked first; any approval rule hit => NEEDS_APPROVAL; otherwise AUTO_HOT.
 */
export function evaluate(intent: PaymentIntent, policy: Policy, s: SpendState): Decision {
  const amount = BigInt(intent.amount);
  const deny = (reason: string): Decision => ({ kind: "DENY", reasons: [reason], warnings: [] });

  if (s.agentStatus !== "active") return deny(`agent is ${s.agentStatus}`);
  if (intent.expiresAt <= s.now) return deny("intent already expired");
  if (!policy.allowedAssets.includes(intent.asset)) return deny(`asset ${intent.asset} not allowed`);
  if (policy.blocklist.includes(intent.payTo)) return deny(`payee ${intent.payTo} is blocklisted`);
  if (amount > BigInt(policy.hardMaxPerPayment)) return deny("amount above hard maximum");
  if (s.payeeCooldownUntil && s.payeeCooldownUntil > s.now) return deny("payee in cooldown after a denial");

  const reasons: string[] = [];
  const allowlisted = policy.allowlist.includes(intent.payTo);
  if (!s.knownPayee && !allowlisted && policy.requireApprovalForNewPayee) reasons.push("new payee");
  if (amount > BigInt(policy.autoPerPayment)) reasons.push("above per-payment auto limit");
  if (BigInt(s.autoSpentToday) + amount > BigInt(policy.autoDaily)) reasons.push("would exceed daily auto budget");
  if (BigInt(s.hotBalance) < amount) reasons.push("hot wallet balance too low");

  const warnings: string[] = [];
  if (!s.knownPayee) warnings.push("First time paying this address");

  if (reasons.length === 0) return { kind: "AUTO_HOT", reasons: ["within policy"], warnings };

  // Only now does the pending-approval cap matter (prevents approval spam / fatigue).
  if (s.pendingApprovals >= policy.maxPendingApprovals) return deny("too many pending approvals");
  return { kind: "NEEDS_APPROVAL", reasons, warnings };
}
