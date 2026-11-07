/**
 * Builds the demo merchant from environment variables. Used by index.ts (standalone, :4200) and by
 * the Leash server when MOUNT_MERCHANT=1 (served at /shop, for single-service deploys).
 */
import { buildMerchant } from "./app.ts";
import { RealNameService } from "@leash/ens";

export function merchantFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const fake = env.MERCHANT_FAKE === "1" || env.LEASH_FAKE_CHAINS === "1";
  return buildMerchant({
    fake,
    leashApi: env.LEASH_API_URL,
    facilitatorUrl: env.X402_FACILITATOR_URL,
    payTo: env.MERCHANT_ACCOUNT_ID || undefined,
    attacker: env.ATTACKER_ACCOUNT_ID || undefined,
    // Token the shop charges in: MERCHANT_ASSET (e.g. 0.0.0 = HBAR) or USDC by default.
    usdc: env.MERCHANT_ASSET || env.HEDERA_USDC_TOKEN_ID,
    // Reads the agent's records straight from ENS (Sepolia, Universal Resolver), never from Leash.
    lookupAgent:
      !fake && env.SEPOLIA_RPC_URL && env.ENS_RESOLVER
        ? (() => {
            const ens = new RealNameService({ rpcUrl: env.SEPOLIA_RPC_URL!, operatorPrivateKey: "0x" + "1".repeat(64), parent: env.ENS_PARENT_NAME ?? "leash.eth", resolver: env.ENS_RESOLVER as any });
            return (name: string) => ens.readRecords(name);
          })()
        : undefined,
    requireAgent: env.MERCHANT_REQUIRE_AGENT === "1",
  });
}
