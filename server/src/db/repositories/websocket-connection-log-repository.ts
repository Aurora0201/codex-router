import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { IdentityMode } from "../../types.js";

type SqliteDatabase = Database.Database;
export type ConnectionOutcome = "connected" | "rejected" | "failed" | "retired" | "closed";

export class WebSocketConnectionLogRepository {
  onUpdated?: (connectionId: string) => void;
  constructor(private readonly db: SqliteDatabase) {}

  start(input: { connectionId: string; accountId?: string; identityMode: IdentityMode; startedAt: number }): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO websocket_connection_log(id,connection_id,account_id,identity_mode,started_at,outcome)
      VALUES(?,?,?,?,?,'connected')`).run(id, input.connectionId, input.accountId ?? null, input.identityMode, input.startedAt);
    this.onUpdated?.(input.connectionId); return id;
  }

  finish(id: string | null, input: { closedAt?: number; handshakeHttpStatus?: number; clientCloseCode?: number; upstreamCloseCode?: number; closeInitiator?: "client" | "upstream" | "gateway"; closeReasonCode?: string; outcome: ConnectionOutcome }): boolean {
    if (!id) return false;
    const result = this.db.prepare(`UPDATE websocket_connection_log SET closed_at=?,handshake_http_status=COALESCE(?,handshake_http_status),client_close_code=?,upstream_close_code=?,close_initiator=?,close_reason_code=?,outcome=? WHERE id=? AND closed_at IS NULL`)
      .run(input.closedAt ?? Date.now(), input.handshakeHttpStatus ?? null, input.clientCloseCode ?? null, input.upstreamCloseCode ?? null, input.closeInitiator ?? null, input.closeReasonCode ?? null, input.outcome, id);
    if (result.changes) {
      const row = this.db.prepare("SELECT connection_id FROM websocket_connection_log WHERE id=?").get(id) as {connection_id:string};
      this.onUpdated?.(row.connection_id);
    }
    return result.changes > 0;
  }

  setHandshake(id: string, status: number): void {
    this.db.prepare("UPDATE websocket_connection_log SET handshake_http_status=? WHERE id=?").run(status,id);
  }

  query(filters: { since:number; outcome?:ConnectionOutcome; accountId?:string; query?:string; cursor?:{startedAt:number;id:string}; page?:number; limit:number }) {
    const where=["websocket_connection_log.started_at>=?"]; const values:Array<string|number>=[filters.since];
    if(filters.outcome){where.push("outcome=?");values.push(filters.outcome);} if(filters.accountId){where.push("account_id=?");values.push(filters.accountId);}
    if(filters.query){where.push("(connection_id LIKE ? OR close_reason_code LIKE ?)");values.push(`%${filters.query}%`,`%${filters.query}%`);}
    if(filters.cursor){where.push("(started_at < ? OR (started_at = ? AND websocket_connection_log.id < ?))");values.push(filters.cursor.startedAt,filters.cursor.startedAt,filters.cursor.id);}
    const base=where.join(" AND "); const total=(this.db.prepare(`SELECT COUNT(*) count FROM websocket_connection_log WHERE ${base}`).get(...values) as {count:number}).count;
    const totalPages=Math.ceil(total/filters.limit); const page=totalPages===0?1:Math.min(filters.page??1,totalPages);
    const rows=this.db.prepare(`SELECT websocket_connection_log.*,COALESCE(accounts.email,accounts.chatgpt_account_id,accounts.id) account_label FROM websocket_connection_log LEFT JOIN accounts ON accounts.id=account_id WHERE ${base} ORDER BY started_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values,filters.limit,(page-1)*filters.limit) as Array<Record<string,unknown>>;
    const items=rows.map((r)=>({id:r.id as string,connectionId:r.connection_id,accountId:r.account_id??undefined,accountLabel:r.account_label??null,identityMode:r.identity_mode,startedAt:r.started_at as number,closedAt:r.closed_at??undefined,handshakeHttpStatus:r.handshake_http_status??undefined,clientCloseCode:r.client_close_code??undefined,upstreamCloseCode:r.upstream_close_code??undefined,closeInitiator:r.close_initiator??undefined,closeReasonCode:r.close_reason_code??undefined,outcome:r.outcome}));
    const last=items.at(-1);const nextCursor=!filters.page&&items.length===filters.limit&&last?{startedAt:last.startedAt,id:last.id}:null;
    return {items,nextCursor,pagination:{page,pageSize:filters.limit,totalItems:total,totalPages}};
  }
}
