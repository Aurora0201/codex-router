import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { RoutingIdentity, SessionRecord, Transport } from "../../types.js";

type SqliteDatabase = Database.Database;

export class SessionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  findByRoutingKey(routingKey: string): { accountId: string } | null {
    const row = this.db.prepare("SELECT account_id FROM session_bindings WHERE routing_key=?").get(routingKey) as { account_id: string } | undefined;
    return row ? { accountId: row.account_id } : null;
  }

  createBinding(identity: RoutingIdentity, transport: Transport, accountId: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO session_bindings(routing_key, account_id, thread_id, session_id, transport, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(identity.routingKey, accountId, identity.threadId, identity.sessionId, transport, now, now);
  }

  touchBinding(routingKey: string): void {
    this.db.prepare("UPDATE session_bindings SET last_seen_at=?, status='active' WHERE routing_key=?").run(Date.now(), routingKey);
  }

  bindAlias(identity: RoutingIdentity, transport: Transport, accountId: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO session_bindings(routing_key, account_id, thread_id, session_id, transport, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(routing_key) DO UPDATE SET last_seen_at=excluded.last_seen_at
    `).run(identity.routingKey, accountId, identity.threadId, identity.sessionId, transport, now, now);
    const row = this.db.prepare("SELECT account_id FROM session_bindings WHERE routing_key=?").get(identity.routingKey) as { account_id: string };
    if (row.account_id !== accountId) throw new Error("session_already_bound_to_different_account");
  }

  list(): SessionRecord[] {
    const rows = this.db.prepare(`
      SELECT s.*, a.chatgpt_account_id AS account_chatgpt_id FROM session_bindings s
      LEFT JOIN accounts a ON a.id=s.account_id ORDER BY s.last_seen_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      routingKey: String(row.routing_key),
      routingKeyHash: createHash("sha256").update(String(row.routing_key)).digest("hex").slice(0, 16),
      accountId: String(row.account_id),
      accountChatgptId: row.account_chatgpt_id == null ? null : String(row.account_chatgpt_id),
      threadId: row.thread_id == null ? null : String(row.thread_id),
      sessionId: row.session_id == null ? null : String(row.session_id),
      transport: String(row.transport) as Transport,
      status: String(row.status) as SessionRecord["status"],
      createdAt: Number(row.created_at),
      lastSeenAt: Number(row.last_seen_at),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
      activeRequests: 0,
    }));
  }

  release(routingKey: string): void {
    const result = this.db.prepare("UPDATE session_bindings SET status='closed', last_seen_at=? WHERE routing_key=?").run(Date.now(), routingKey);
    if (result.changes === 0) throw new Error("session_not_found");
  }

  deleteAccountBindings(accountId: string): void {
    this.db.prepare("DELETE FROM session_bindings WHERE account_id=? AND status!='active'").run(accountId);
  }
}
