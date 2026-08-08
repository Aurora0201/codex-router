import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const SCHEMA_VERSION = 3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  plan_type TEXT,
  codex_home TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  auth_status TEXT NOT NULL,
  fedramp INTEGER NOT NULL DEFAULT 0,
  chatgpt_account_id TEXT,
  primary_used_percent REAL,
  primary_resets_at INTEGER,
  primary_window_minutes INTEGER,
  secondary_used_percent REAL,
  secondary_resets_at INTEGER,
  secondary_window_minutes INTEGER,
  rate_limit_reached_type TEXT,
  last_auth_refresh_at INTEGER,
  last_limits_refresh_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_log (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  route TEXT NOT NULL,
  transport TEXT NOT NULL,
  account_id TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at DESC);
`;

const V2_STATEMENTS = `
CREATE TABLE IF NOT EXISTS gateway_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_account_id TEXT NULL,
  FOREIGN KEY(active_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO gateway_state(singleton, active_account_id) VALUES (1, NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_chatgpt_account_id
ON accounts(chatgpt_account_id) WHERE chatgpt_account_id IS NOT NULL;
`;

function tableColumns(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function currentVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
  return row.version ?? 0;
}

export function migrate(db: SqliteDatabase): void {
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('requestMetadataLogging', 'true')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('theme', '\"system\"')").run();

  const version = currentVersion(db);
  if (version < 2) {
    const accountColumns = tableColumns(db, "accounts");
    const adds: string[] = [];
    if (!accountColumns.has("chatgpt_account_id")) adds.push("chatgpt_account_id TEXT");
    if (!accountColumns.has("rate_limit_reached_type")) adds.push("rate_limit_reached_type TEXT");
    for (const column of adds) db.exec(`ALTER TABLE accounts ADD COLUMN ${column}`);
    db.exec(V2_STATEMENTS);
  }
  if (version < 3) {
    const logColumns = tableColumns(db, "request_log");
    if (logColumns.has("routing_key_hash")) db.exec("ALTER TABLE request_log DROP COLUMN routing_key_hash");
    db.exec("DROP TABLE IF EXISTS session_bindings");
  }

  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, Date.now());
}
