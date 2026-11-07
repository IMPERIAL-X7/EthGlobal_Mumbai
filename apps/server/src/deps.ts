import { FakeWorldVerifier, RealWorldVerifier, type WorldVerifier } from "@leash/world";
import { FakeAuditLog, FakeLedger, HcsAuditLog, PrivateKey, RealLedger, type AuditLog, type Ledger } from "@leash/hedera";
import { FakeNameService, RealNameService, type NameService } from "@leash/ens";
import type { Hex, Address } from "viem";
import type { Config } from "./config.ts";
import { openDb, type DB } from "./db.ts";
import { Bus } from "./bus.ts";

export interface Deps {
  cfg: Config;
  db: DB;
  bus: Bus;
  world: WorldVerifier;
  ledger: Ledger;
  serverKey: PrivateKey;
  audit: AuditLog;
  ens: NameService;
}

export function buildDeps(cfg: Config, overrides: Partial<Deps> = {}): Deps {
  const db = overrides.db ?? openDb(cfg.DATABASE_URL);

  const world =
    overrides.world ??
    (cfg.fake.world
      ? new FakeWorldVerifier()
      : new RealWorldVerifier({ appId: cfg.WORLD_APP_ID!, rpId: cfg.WORLD_RP_ID!, signingKeyHex: cfg.WORLD_SIGNING_KEY!, environment: cfg.WORLD_ENV }));

  let ledger: Ledger;
  let serverKey: PrivateKey;
  let audit: AuditLog;
  if (cfg.fake.hedera) {
    const fl = new FakeLedger(cfg.LEASH_SERVER_COSIGN_KEY ? PrivateKey.fromStringDer(cfg.LEASH_SERVER_COSIGN_KEY) : undefined);
    ledger = fl;
    serverKey = fl.getServerKey();
    audit = new FakeAuditLog();
  } else {
    const rl = new RealLedger({
      network: cfg.HEDERA_NETWORK,
      operatorId: cfg.HEDERA_OPERATOR_ID!,
      operatorKey: cfg.HEDERA_OPERATOR_KEY!,
      serverCosignKey: cfg.LEASH_SERVER_COSIGN_KEY!,
      mirrorUrl: cfg.HEDERA_MIRROR_URL,
    });
    ledger = rl;
    serverKey = rl.getServerKey();
    audit = new HcsAuditLog(rl.client, cfg.HCS_AUDIT_TOPIC_ID!, cfg.HEDERA_NETWORK);
  }

  const ens =
    overrides.ens ??
    (cfg.fake.ens
      ? new FakeNameService(cfg.ENS_PARENT_NAME)
      : new RealNameService({
          rpcUrl: cfg.SEPOLIA_RPC_URL!,
          operatorPrivateKey: cfg.ENS_OPERATOR_PRIVATE_KEY!,
          parent: cfg.ENS_PARENT_NAME,
          resolver: cfg.ENS_RESOLVER as Address,
        }));

  return {
    cfg,
    db,
    bus: overrides.bus ?? new Bus(),
    world,
    ledger: overrides.ledger ?? ledger,
    serverKey: overrides.serverKey ?? serverKey,
    audit: overrides.audit ?? audit,
    ens,
  };
}
