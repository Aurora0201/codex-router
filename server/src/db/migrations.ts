import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const SCHEMA_VERSION = 17;

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
  subscription_started_at INTEGER,
  subscription_expires_at INTEGER,
  subscription_expiry_source TEXT,
  billing_anchor_at INTEGER,
  billing_cadence TEXT,
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
  auth_mode TEXT,
  auth_checked_at INTEGER,
  auth_last_successful_at INTEGER,
  auth_error_code TEXT,
  limits_snapshot_json TEXT,
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
  outcome TEXT NOT NULL DEFAULT 'upstream_error',
  scope TEXT NOT NULL DEFAULT 'request',
  identity_mode TEXT NOT NULL DEFAULT 'managed_account',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

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
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return new Set(rows.map((row) => row.name));
}

function currentVersion(db: SqliteDatabase): number {
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_migrations")
    .get() as { version: number | null };
  return row.version ?? 0;
}

export function migrate(db: SqliteDatabase): void {
  db.exec(SCHEMA);
  db.prepare(
    "INSERT OR IGNORE INTO settings(key, value_json) VALUES ('requestMetadataLogging', 'true')",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO settings(key, value_json) VALUES ('theme', '\"system\"')",
  ).run();
  db.prepare(
    "INSERT OR IGNORE INTO settings(key, value_json) VALUES ('logLevel', '\"info\"')",
  ).run();

  const version = currentVersion(db);
  if (version < 2) {
    const accountColumns = tableColumns(db, "accounts");
    const adds: string[] = [];
    if (!accountColumns.has("chatgpt_account_id"))
      adds.push("chatgpt_account_id TEXT");
    if (!accountColumns.has("rate_limit_reached_type"))
      adds.push("rate_limit_reached_type TEXT");
    for (const column of adds)
      db.exec(`ALTER TABLE accounts ADD COLUMN ${column}`);
    db.exec(V2_STATEMENTS);
  }
  if (version < 3) {
    const logColumns = tableColumns(db, "request_log");
    if (logColumns.has("routing_key_hash"))
      db.exec("ALTER TABLE request_log DROP COLUMN routing_key_hash");
    db.exec("DROP TABLE IF EXISTS session_bindings");
  }
  if (version < 4) {
    db.exec(`
      UPDATE accounts SET primary_resets_at = primary_resets_at * 1000
      WHERE primary_resets_at > 0 AND primary_resets_at < 100000000000;
      UPDATE accounts SET secondary_resets_at = secondary_resets_at * 1000
      WHERE secondary_resets_at > 0 AND secondary_resets_at < 100000000000;
    `);
  }
  if (version < 5) {
    const logColumns = tableColumns(db, "request_log");
    if (!logColumns.has("outcome"))
      db.exec(
        "ALTER TABLE request_log ADD COLUMN outcome TEXT NOT NULL DEFAULT 'upstream_error'",
      );
    if (!logColumns.has("scope"))
      db.exec(
        "ALTER TABLE request_log ADD COLUMN scope TEXT NOT NULL DEFAULT 'request'",
      );
    db.exec(`
      UPDATE request_log SET scope = 'connection'
      WHERE transport = 'ws'
         OR status_code = 101
         OR error_code LIKE 'client_close_%'
         OR error_code LIKE 'upstream_close_%'
         OR error_code LIKE '%websocket%';

      UPDATE request_log SET outcome = CASE
        WHEN lower(COALESCE(error_code, '')) IN ('this operation was aborted', 'client_cancelled') THEN 'client_cancelled'
        WHEN error_code IN ('no_active_account_selected', 'account_disabled', 'account_not_ready', 'fedramp_accounts_not_supported', 'raw_request_body_unavailable') THEN 'gateway_error'
        WHEN status_code IS NOT NULL AND status_code < 400 THEN 'success'
        WHEN status_code IS NOT NULL AND status_code < 500 THEN 'rejected'
        ELSE 'upstream_error'
      END;
    `);
  }
  if (version < 6) {
    db.exec(`
      UPDATE request_log
      SET outcome = 'client_cancelled', status_code = NULL, error_code = 'client_cancelled'
      WHERE outcome = 'client_cancelled'
         OR lower(COALESCE(error_code, '')) = 'this operation was aborted';
    `);
  }
  if (version < 7) {
    db.exec(`
      UPDATE request_log
      SET outcome = CASE
        WHEN lower(COALESCE(error_code, '')) IN ('this operation was aborted', 'client_cancelled') THEN 'client_cancelled'
        WHEN error_code IN ('no_active_account_selected', 'account_disabled', 'account_not_ready', 'fedramp_accounts_not_supported', 'raw_request_body_unavailable') THEN 'gateway_error'
        WHEN status_code >= 200 AND status_code < 400 THEN 'success'
        WHEN status_code >= 400 AND status_code < 500 THEN 'rejected'
        WHEN status_code >= 500 THEN 'upstream_error'
        ELSE outcome
      END
      WHERE scope = 'request';
    `);
  }
  if (version < 8) {
    const logColumns = tableColumns(db, "request_log");
    if (!logColumns.has("identity_mode")) {
      db.exec(
        "ALTER TABLE request_log ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'managed_account'",
      );
    }
  }
  if (version < 9) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE request_log_v9 (
          id TEXT PRIMARY KEY,
          request_id TEXT,
          route TEXT NOT NULL,
          transport TEXT NOT NULL,
          account_id TEXT,
          state TEXT NOT NULL,
          outcome TEXT,
          failure_source TEXT,
          failure_stage TEXT,
          http_status INTEGER,
          protocol_error_code TEXT,
          diagnostic_code TEXT,
          upstream_request_id TEXT,
          diagnostic_headers_json TEXT,
          bytes_in INTEGER,
          bytes_out INTEGER,
          identity_mode TEXT NOT NULL DEFAULT 'managed_account',
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
        );
        CREATE TABLE websocket_connection_log (
          id TEXT PRIMARY KEY,
          source_log_id TEXT UNIQUE,
          connection_id TEXT NOT NULL,
          account_id TEXT,
          identity_mode TEXT NOT NULL DEFAULT 'managed_account',
          started_at INTEGER NOT NULL,
          closed_at INTEGER,
          handshake_http_status INTEGER,
          client_close_code INTEGER,
          upstream_close_code INTEGER,
          close_initiator TEXT,
          close_reason_code TEXT,
          outcome TEXT NOT NULL,
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
        );
        INSERT INTO request_log_v9 (
          id, request_id, route, transport, account_id, state, outcome,
          http_status, protocol_error_code, diagnostic_code, bytes_in, bytes_out,
          identity_mode, started_at, completed_at
        )
        SELECT id, request_id, route, transport, account_id,
          CASE outcome
            WHEN 'success' THEN 'completed'
            WHEN 'rejected' THEN 'rejected'
            WHEN 'client_cancelled' THEN 'cancelled'
            ELSE 'failed'
          END,
          outcome,
          CASE WHEN transport <> 'ws' THEN status_code END,
          CASE WHEN transport = 'ws' AND scope = 'request' THEN error_code END,
          CASE WHEN transport <> 'ws' THEN error_code END,
          bytes_in, bytes_out, identity_mode, created_at,
          CASE WHEN duration_ms IS NULL THEN created_at ELSE created_at + duration_ms END
        FROM request_log WHERE scope = 'request';
        INSERT OR IGNORE INTO websocket_connection_log (
          id, source_log_id, connection_id, account_id, identity_mode, started_at,
          closed_at, handshake_http_status, close_reason_code, outcome
        )
        SELECT id, id, COALESCE(request_id, id), account_id, identity_mode, created_at,
          CASE WHEN duration_ms IS NULL THEN created_at ELSE created_at + duration_ms END,
          status_code, error_code,
          CASE
            WHEN error_code = 'account_switch_connection_retired' THEN 'retired'
            WHEN status_code = 101 THEN 'closed'
            WHEN status_code IS NOT NULL AND status_code < 500 THEN 'rejected'
            ELSE 'failed'
          END
        FROM request_log WHERE scope = 'connection';
        DROP TABLE request_log;
        ALTER TABLE request_log_v9 RENAME TO request_log;
        CREATE INDEX idx_request_log_started ON request_log(started_at DESC);
        CREATE INDEX idx_request_log_state_started ON request_log(state, started_at DESC);
        CREATE INDEX idx_request_log_outcome_started ON request_log(outcome, started_at DESC);
        CREATE INDEX idx_websocket_connection_started ON websocket_connection_log(started_at DESC);
        CREATE INDEX idx_websocket_connection_outcome_started ON websocket_connection_log(outcome, started_at DESC);
      `);
    })();
  }
  if (version < 10) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_request_log_state_started ON request_log(state, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_request_log_outcome_started ON request_log(outcome, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_websocket_connection_outcome_started ON websocket_connection_log(outcome, started_at DESC);
    `);
  }
  if (version < 11) {
    const logColumns = tableColumns(db, "request_log");
    if (!logColumns.has("transport_error_json")) {
      db.exec("ALTER TABLE request_log ADD COLUMN transport_error_json TEXT");
    }
  }
  if (version < 12) {
    const accountColumns = tableColumns(db, "accounts");
    if (!accountColumns.has("subscription_started_at")) {
      db.exec("ALTER TABLE accounts ADD COLUMN subscription_started_at INTEGER");
    }
  }
  if (version < 13) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS codex_usage_rollout (
        thread_id TEXT PRIMARY KEY,
        source_hash TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        encoding TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        byte_offset INTEGER NOT NULL DEFAULT 0,
        next_ordinal INTEGER NOT NULL DEFAULT 0,
        session_started_at INTEGER,
        last_event_at INTEGER,
        project_key TEXT,
        project_label TEXT,
        latest_model TEXT,
        previous_input_tokens INTEGER,
        previous_cached_input_tokens INTEGER,
        previous_output_tokens INTEGER,
        previous_reasoning_output_tokens INTEGER,
        warning_count INTEGER NOT NULL DEFAULT 0,
        last_scanned_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS codex_usage_event (
        thread_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        model TEXT,
        project_key TEXT,
        project_label TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(thread_id, ordinal),
        FOREIGN KEY(thread_id) REFERENCES codex_usage_rollout(thread_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_codex_usage_event_time ON codex_usage_event(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_codex_usage_event_model_time ON codex_usage_event(model, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_codex_usage_event_project_time ON codex_usage_event(project_key, occurred_at);
    `);
  }
  if (version < 14) {
    // Usage rows are derived from rollout files. Rebuild them so project
    // classification changes never leave stale date-based project buckets.
    db.exec("DELETE FROM codex_usage_rollout");
  }
  if (version < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS codex_usage_retained_rollout (
        source_hash TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        source_category TEXT NOT NULL,
        session_started_at INTEGER,
        last_event_at INTEGER,
        project_key TEXT,
        project_label TEXT,
        latest_model TEXT,
        warning_count INTEGER NOT NULL DEFAULT 0,
        last_scanned_at INTEGER NOT NULL,
        missing_at INTEGER NOT NULL,
        restored_at INTEGER,
        PRIMARY KEY(source_hash, thread_id)
      );
      CREATE TABLE IF NOT EXISTS codex_usage_retained_event (
        source_hash TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        model TEXT,
        project_key TEXT,
        project_label TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(source_hash, thread_id, ordinal),
        FOREIGN KEY(source_hash, thread_id) REFERENCES codex_usage_retained_rollout(source_hash, thread_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_codex_usage_retained_event_source_time ON codex_usage_retained_event(source_hash, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_codex_usage_retained_event_source_model_time ON codex_usage_retained_event(source_hash, model, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_codex_usage_retained_event_source_project_time ON codex_usage_retained_event(source_hash, project_key, occurred_at);
    `);
  }
  if (version < 16) {
    const accountColumns = tableColumns(db, "accounts");
    const additions = [
      ["subscription_expires_at", "INTEGER"],
      ["subscription_expiry_source", "TEXT"],
      ["auth_mode", "TEXT"],
      ["auth_checked_at", "INTEGER"],
      ["auth_last_successful_at", "INTEGER"],
      ["auth_error_code", "TEXT"],
      ["limits_snapshot_json", "TEXT"],
    ] as const;
    for (const [column, type] of additions) {
      if (!accountColumns.has(column)) db.exec(`ALTER TABLE accounts ADD COLUMN ${column} ${type}`);
    }
    db.exec(`
      UPDATE accounts
      SET subscription_expires_at = subscription_started_at + 2592000000,
          subscription_expiry_source = 'legacy_estimate'
      WHERE subscription_started_at IS NOT NULL
        AND subscription_expires_at IS NULL;
      UPDATE accounts
      SET auth_last_successful_at = last_auth_refresh_at
      WHERE auth_last_successful_at IS NULL
        AND last_auth_refresh_at IS NOT NULL;
    `);
  }
  if (version < 17) {
    const accountColumns = tableColumns(db, "accounts");
    if (!accountColumns.has("billing_anchor_at")) {
      db.exec("ALTER TABLE accounts ADD COLUMN billing_anchor_at INTEGER");
    }
    if (!accountColumns.has("billing_cadence")) {
      db.exec("ALTER TABLE accounts ADD COLUMN billing_cadence TEXT");
    }
  }

  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
  ).run(SCHEMA_VERSION, Date.now());
}
