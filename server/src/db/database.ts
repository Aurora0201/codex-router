import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";
import { AccountRepository } from "./repositories/account-repository.js";
import { SettingsRepository } from "./repositories/settings-repository.js";
import { RequestLogRepository } from "./repositories/request-log-repository.js";
import { WebSocketConnectionLogRepository } from "./repositories/websocket-connection-log-repository.js";

type SqliteDatabase = Database.Database;

export class GatewayDatabase {
  readonly raw: SqliteDatabase;
  readonly accounts: AccountRepository;
  readonly settings: SettingsRepository;
  readonly requestLog: RequestLogRepository;
  readonly websocketConnectionLog: WebSocketConnectionLogRepository;

  private activeAccountId: string | null = null;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.raw = new Database(databasePath);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("busy_timeout = 5000");
    migrate(this.raw);
    this.accounts = new AccountRepository(this.raw);
    this.settings = new SettingsRepository(this.raw);
    this.requestLog = new RequestLogRepository(this.raw, this.settings);
    this.websocketConnectionLog = new WebSocketConnectionLogRepository(this.raw);
    this.requestLog.interruptRunning();
    this.activeAccountId = this.readActiveAccountId();
  }

  close(): void {
    this.raw.close();
  }

  getActiveAccountId(): string | null {
    return this.activeAccountId;
  }

  setActiveAccountId(id: string | null): void {
    this.raw.prepare("UPDATE gateway_state SET active_account_id=?").run(id);
    this.activeAccountId = id;
  }

  private readActiveAccountId(): string | null {
    const row = this.raw.prepare("SELECT active_account_id FROM gateway_state WHERE singleton=1").get() as { active_account_id: string | null } | undefined;
    return row?.active_account_id ?? null;
  }
}
