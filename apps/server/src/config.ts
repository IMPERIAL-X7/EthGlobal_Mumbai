import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Minimal .env loader (no dependency). Real env vars win over the file. */
export function loadDotenv(path = resolve(process.cwd(), ".env")) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (!m) continue;
    const [, k, raw] = m;
    const v = raw!.replace(/^["']|["']$/g, "");
    if (process.env[k!] === undefined && v !== "") process.env[k!] = v;
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const Env = z.object({
  PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().default("http://localhost:4000"),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./leash.db"),
  SESSION_SECRET: z.string().optional(),
  LEASH_FAKE_CHAINS: bool,

  WORLD_APP_ID: z.string().optional(),
  WORLD_RP_ID: z.string().optional(),
  WORLD_SIGNING_KEY: z.string().optional(),
  WORLD_ENV: z.enum(["staging", "production"]).default("staging"),

  HEDERA_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEDERA_OPERATOR_ID: z.string().optional(),
  HEDERA_OPERATOR_KEY: z.string().optional(),
  LEASH_SERVER_COSIGN_KEY: z.string().optional(),
  HEDERA_MIRROR_URL: z.string().default("https://testnet.mirrornode.hedera.com"),
  HEDERA_USDC_TOKEN_ID: z.string().default("0.0.429274"),
  HCS_AUDIT_TOPIC_ID: z.string().optional(),
  X402_FACILITATOR_URL: z.string().default("https://api.testnet.blocky402.com"),

  SEPOLIA_RPC_URL: z.string().optional(),
  ENS_OPERATOR_PRIVATE_KEY: z.string().optional(),
  ENS_PARENT_NAME: z.string().default("leash.eth"),
  ENS_USER_REGISTRY: z.string().optional(),
  ENS_RESOLVER: z.string().optional(),
});
export type Config = z.infer<typeof Env> & {
  fake: { world: boolean; hedera: boolean; ens: boolean };
};

/**
 * Each chain falls back to its fake independently when its keys are missing,
 * so you can go live with Hedera first while World/ENS are still placeholders.
 * LEASH_FAKE_CHAINS=1 forces everything fake.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  const all = c.LEASH_FAKE_CHAINS;
  return {
    ...c,
    fake: {
      world: all || !(c.WORLD_APP_ID && c.WORLD_RP_ID && c.WORLD_SIGNING_KEY),
      hedera: all || !(c.HEDERA_OPERATOR_ID && c.HEDERA_OPERATOR_KEY && c.LEASH_SERVER_COSIGN_KEY && c.HCS_AUDIT_TOPIC_ID),
      ens: all || !(c.SEPOLIA_RPC_URL && c.ENS_OPERATOR_PRIVATE_KEY && c.ENS_USER_REGISTRY && c.ENS_RESOLVER),
    },
  };
}
