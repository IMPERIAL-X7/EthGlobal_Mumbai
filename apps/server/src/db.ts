import Database from "better-sqlite3";

export type DB = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  world_session_id TEXT NOT NULL UNIQUE,
  enrollment_nullifier TEXT NOT NULL UNIQUE,   -- one human = one owner account
  fresh_presence_at INTEGER,                    -- last proveSession (fallback owner binding)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  label TEXT NOT NULL UNIQUE,
  ens_name TEXT NOT NULL,
  hot_account TEXT NOT NULL,
  vault_account TEXT NOT NULL,
  agent_public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | revoked
  api_key_hash TEXT NOT NULL UNIQUE,
  last_watch_ts TEXT NOT NULL DEFAULT '0',      -- mirror-node watermark for bypass detection
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,                              -- approval id (NULL for the initial policy)
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, version)
);

CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  kind TEXT NOT NULL,                            -- payment | policy_change
  canonical_json TEXT NOT NULL,                  -- the frozen intent
  hash TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL,                        -- AUTO_HOT | NEEDS_APPROVAL | DENY
  reasons TEXT NOT NULL,
  status TEXT NOT NULL,                          -- see services/intents.ts
  fee_payer TEXT,
  reserved_auto TEXT NOT NULL DEFAULT '0',       -- daily-budget reservation for AUTO_HOT
  payload_json TEXT,                             -- e.g. proposed policy
  summary TEXT NOT NULL,                         -- built ONLY from frozen facts (shown in World App)
  agent_reason TEXT,                             -- the agent's own words: untrusted, dashboard only
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES intents(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  world_action TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,                          -- pending | approved | denied | expired | cancelled
  warnings TEXT NOT NULL,
  nullifier TEXT,                                -- World proof that approved it
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nullifiers (
  nullifier TEXT NOT NULL,
  action TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (nullifier, action)                -- replay protection
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES intents(id),
  agent_id TEXT NOT NULL,
  source TEXT NOT NULL,                          -- hot | vault
  tx_id TEXT NOT NULL UNIQUE,
  consensus_at TEXT,
  receipt_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payees (
  agent_id TEXT NOT NULL,
  account TEXT NOT NULL,
  label TEXT,
  first_seen INTEGER NOT NULL,
  total_paid TEXT NOT NULL DEFAULT '0',
  count INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER,
  PRIMARY KEY (agent_id, account)
);

CREATE TABLE IF NOT EXISTS spend_counters (
  agent_id TEXT NOT NULL,
  day TEXT NOT NULL,
  asset TEXT NOT NULL,
  auto_spent TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (agent_id, day, asset)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  payload_json TEXT,
  payload_hash TEXT,
  topic_id TEXT,
  seq INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_agent ON intents(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_id, id);
`;

export function openDb(url: string): DB {
  const file = url.startsWith("file:") ? url.slice(5) : url;
  const db = new Database(file);
  db.exec(SCHEMA);
  // Columns added after first release (CREATE TABLE IF NOT EXISTS won't add them to old DBs).
  const cols = (db.prepare(`PRAGMA table_info(intents)`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("agent_reason")) db.exec(`ALTER TABLE intents ADD COLUMN agent_reason TEXT`);
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
