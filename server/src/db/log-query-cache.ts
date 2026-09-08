import type Database from "better-sqlite3";

// Cache only bounded diagnostic metadata. Any database write invalidates it,
// including account label changes and writes made through another connection.
export class LogQueryCache {
  private readonly entries = new Map<string, { expiresAt: number; value: unknown }>();
  private revision = "";
  private readonly changes: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.changes = db.prepare("SELECT total_changes() AS count");
  }

  get<T>(key: string, read: () => T): T {
    // A snapshot created within a transaction must not survive its rollback.
    if (this.db.inTransaction) return read();
    const revision = String((this.changes.get() as { count: number }).count)
      + ":" + String(this.db.pragma("data_version", { simple: true }));
    if (revision !== this.revision) {
      this.entries.clear();
      this.revision = revision;
    }
    const now = Date.now();
    const current = this.entries.get(key);
    if (current && current.expiresAt > now) return structuredClone(current.value) as T;
    const value = read();
    this.entries.delete(key);
    if (this.entries.size >= 16) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value: structuredClone(value), expiresAt: now + 1_000 });
    return value;
  }

  window(rangeMs: number): { since: number; until: number } {
    return this.get("window:" + rangeMs, () => {
      const until = Date.now();
      return { since: until - rangeMs, until };
    });
  }
}
