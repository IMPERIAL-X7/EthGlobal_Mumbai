import { z } from "zod";
import { HederaId, Network, UnitAmount } from "./intent.ts";
import { Policy } from "./policy.ts";

/** Agent -> Leash: "I got a 402 for this; may I pay?" (normalised from x402 PaymentRequirements) */
export const SubmitPaymentReq = z.object({
  network: Network,
  asset: HederaId,
  payTo: HederaId,
  amount: UnitAmount,
  resource: z.string().url(),
  description: z.string().max(280).optional(),
  /** x402 facilitator fee payer (extra.feePayer); the co-sign validator requires the tx to use it. */
  feePayer: HederaId.optional(),
});
export type SubmitPaymentReq = z.infer<typeof SubmitPaymentReq>;

export const CreateAgentReq = z.object({
  name: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  /** Owner recovery public key (generated in the browser). Optional in dev: server generates one and returns it once. */
  ownerRecoveryPublicKey: z.string().optional(),
  policy: Policy.optional(),
});
export type CreateAgentReq = z.infer<typeof CreateAgentReq>;

export const ProposePolicyReq = z.object({ policy: Policy });

export const CosignReq = z.object({ txBytesBase64: z.string().min(16) });
export const SettledReq = z.object({ txId: z.string().min(5), source: z.enum(["hot", "vault"]) });
export const RefillReq = z.object({ amount: UnitAmount, asset: HederaId });
export const PolicyRequestReq = z.object({ reason: z.string().max(280), policy: Policy });

/** IDKit completion result, forwarded unchanged from the browser. Opaque to us until verified. */
export const WorldProofReq = z.object({ result: z.unknown() });
