import { createServer } from "node:http";
import { loadConfig, loadDotenv } from "./config.ts";
import { buildDeps } from "./deps.ts";
import { buildApp } from "./http.ts";
import { attachSockets } from "./socket.ts";
import { startJobs } from "./jobs.ts";

loadDotenv();
const cfg = loadConfig();
const deps = buildDeps(cfg);
const app = buildApp(deps);
const server = createServer(app);
attachSockets(server, deps);
startJobs(deps);

server.listen(cfg.PORT, () => {
  const m = (fake: boolean) => (fake ? "FAKE" : "live");
  console.log(`Leash server on :${cfg.PORT}  world=${m(cfg.fake.world)} hedera=${m(cfg.fake.hedera)} ens=${m(cfg.fake.ens)}`);
  if (deps.ledger.mode === "fake") console.log("  (fake ledger) server co-sign public key:", deps.ledger.serverPublicKey);
});
