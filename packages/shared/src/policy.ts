import { z } from "zod";
import { HederaId, UnitAmount, canonicalize, sha256Hex } from "./intent.ts";

export const Policy = z.object({
  v: z.literal(1),
  /** Payments at or below this go through automatically from the hot wallet. */
  autoPerPayment: UnitAmount,
  /** Total automatic spend allowed per UTC day. */
  autoDaily: UnitAmount,
  /** Above this a payment is refused outright, even with approval. */
  hardMaxPerPayment: UnitAmount,
  requireApprovalForNewPayee: z.boolean(),
  allowlist: z.array(HederaId).max(200).default([]),
  blocklist: z.array(HederaId).max(200).default([]),
  allowedAssets: z.array(HederaId).min(1),
  approvalTtlSeconds: z.number().int().min(30).max(3600),
  maxPendingApprovals: z.number().int().min(1).max(20),
  /** After a denial, block new requests to the same payee for this long (anti approval-spam). */
  denyCooldownSeconds: z.number().int().min(0).max(86400),
});
export type Policy = z.infer<typeof Policy>;

export function hashPolicy(p: Policy): string {
  return sha256Hex(canonicalize(Policy.parse(p)));
}

export const USDC_TESTNET = "0.0.429274";
export const HBAR = "0.0.0";

/** Demo defaults (USDC, 6 decimals): auto ≤ 0.10, ≤ 1.00/day, hard max 50. */
export function defaultPolicy(): Policy {
  return {
    v: 1,
    autoPerPayment: "100000",
    autoDaily: "1000000",
    hardMaxPerPayment: "50000000",
    requireApprovalForNewPayee: true,
    allowlist: [],
    blocklist: [],
    allowedAssets: [USDC_TESTNET, HBAR],
    approvalTtlSeconds: 600,
    maxPendingApprovals: 3,
    denyCooldownSeconds: 300,
  };
}
