import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** Hedera entity id like 0.0.12345 */
export const HederaId = z.string().regex(/^\d+\.\d+\.\d+$/, "expected Hedera id like 0.0.123");
/** Integer amount in the asset's smallest unit, as a decimal string (no floats anywhere). */
export const UnitAmount = z.string().regex(/^[1-9]\d{0,30}$/, "positive integer string");
export const Network = z.enum(["hedera:testnet", "hedera:mainnet"]);

const IntentBase = {
  v: z.literal(1),
  agentId: z.string().min(1),
  nonce: z.string().min(8),
  createdAt: z.number().int(), // unix seconds
  expiresAt: z.number().int(),
};

export const PaymentIntent = z.object({
  ...IntentBase,
  kind: z.literal("payment"),
  network: Network,
  asset: HederaId, // "0.0.0" = HBAR, otherwise HTS token id
  payTo: HederaId,
  amount: UnitAmount,
  resource: z.string().url(),
  description: z.string().max(280).optional(),
});
export type PaymentIntent = z.infer<typeof PaymentIntent>;

export const PolicyChangeIntent = z.object({
  ...IntentBase,
  kind: z.literal("policy_change"),
  policyHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PolicyChangeIntent = z.infer<typeof PolicyChangeIntent>;

export const Intent = z.discriminatedUnion("kind", [PaymentIntent, PolicyChangeIntent]);
export type Intent = z.infer<typeof Intent>;

/**
 * Canonical JSON (RFC 8785-style for our value space: objects, arrays, strings, integers, booleans).
 * Keys sorted, no whitespace, undefined dropped. Same output in Node and the browser.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("canonicalize: only safe integers allowed");
    return String(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}

/** The hash that the human approves. Any change to any field changes it. */
export function hashIntent(intent: Intent): string {
  return sha256Hex(canonicalize(Intent.parse(intent)));
}

/**
 * World ID action string bound to one intent. 128-bit prefix of the hash.
 * (Spike S5: confirm World's action length/charset limits.)
 */
export function worldActionFor(intent: Intent, hash = hashIntent(intent)): string {
  const prefix = intent.kind === "payment" ? "pay" : "pol";
  return `leash_${prefix}_${hash.slice(0, 32)}`;
}

export const ENROLL_ACTION = "leash_enroll";
