import { loadDotenv } from "../../server/src/config.ts";
import { merchantFromEnv } from "./fromEnv.ts";

loadDotenv();
const env = process.env;
const fake = env.MERCHANT_FAKE === "1" || env.LEASH_FAKE_CHAINS === "1";
const app = merchantFromEnv(env);
const port = Number(env.MERCHANT_PORT ?? 4200);
app.listen(port, () => console.log(`merchant on :${port} (${fake ? "FAKE facilitator" : env.X402_FACILITATOR_URL ?? "blocky402"})`));
