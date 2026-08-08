import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

const ALLOWED_KEYS = new Set(["requestMetadataLogging", "theme"]);

export class SettingsRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get(): Record<string, unknown> {
    const rows = this.db.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
  }

  update(values: Record<string, unknown>): Record<string, unknown> {
    const statement = this.db.prepare("INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json");
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!ALLOWED_KEYS.has(key)) throw new Error("unsupported_setting");
        if (key === "requestMetadataLogging" && typeof value !== "boolean") throw new Error("invalid_setting");
        if (key === "theme" && !["system", "light", "dark"].includes(String(value))) throw new Error("invalid_setting");
        statement.run(key, JSON.stringify(value));
      }
    })();
    return this.get();
  }

  requestMetadataLoggingEnabled(): boolean {
    return this.get().requestMetadataLogging === true;
  }
}
