import { buildMerchant } from "./app.ts";

const env = process.env;
const fake = env.MERCHANT_FAKE === "1" || env.LEASH_FAKE_CHAINS === "1";
const app = buildMerchant({
  fake,
  leashApi: env.LEASH_API_URL,
  facilitatorUrl: env.X402_FACILITATOR_URL,
  payTo: env.MERCHANT_ACCOUNT_ID || undefined,
  attacker: env.ATTACKER_ACCOUNT_ID || undefined,
  usdc: env.HEDERA_USDC_TOKEN_ID,
});
const port = Number(env.MERCHANT_PORT ?? 4200);
app.listen(port, () => console.log(`merchant on :${port} (${fake ? "FAKE facilitator" : env.X402_FACILITATOR_URL ?? "blocky402"})`));
