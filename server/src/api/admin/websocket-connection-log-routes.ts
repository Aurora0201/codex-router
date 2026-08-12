import type { FastifyInstance } from "fastify";
import type { ConnectionOutcome } from "../../db/repositories/websocket-connection-log-repository.js";
import type { AdminContext } from "./context.js";

const RANGES: Record<string, number> = {
  "1h": 3600000,
  "24h": 86400000,
  "7d": 604800000,
};
const OUTCOMES = new Set<ConnectionOutcome>([
  "connected",
  "rejected",
  "failed",
  "retired",
  "closed",
]);
const INITIATORS = new Set(["client", "upstream", "gateway"]);
function decodeCursor(
  value: string | undefined,
): { startedAt: number; id: string } | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as { startedAt?: unknown; id?: unknown };
  if (typeof parsed.startedAt !== "number" || typeof parsed.id !== "string")
    throw new Error();
  return { startedAt: parsed.startedAt, id: parsed.id };
}
export function registerWebSocketConnectionLogRoutes(
  app: FastifyInstance,
  ctx: AdminContext,
): void {
  app.get("/api/websocket-connection-logs", async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const range = query.range ?? "24h";
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const page = query.page === undefined ? undefined : Number(query.page);
      const number = (value: string | undefined) =>
        value === undefined ? undefined : Number(value);
      const from = number(query.from);
      const to = number(query.to);
      const handshakeHttpStatus = number(query.handshakeHttpStatus);
      const clientCloseCode = number(query.clientCloseCode);
      const upstreamCloseCode = number(query.upstreamCloseCode);
      if (
        !RANGES[range] ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (page !== undefined && (!Number.isInteger(page) || page < 1)) ||
        (page !== undefined && query.cursor !== undefined)
      )
        throw new Error();
      if (
        (from !== undefined && !Number.isSafeInteger(from)) ||
        (to !== undefined && !Number.isSafeInteger(to)) ||
        (from !== undefined && to !== undefined && from > to)
      )
        throw new Error();
      if (
        [handshakeHttpStatus, clientCloseCode, upstreamCloseCode].some(
          (value) => value !== undefined && !Number.isInteger(value),
        )
      )
        throw new Error();
      if (query.outcome && !OUTCOMES.has(query.outcome as ConnectionOutcome))
        throw new Error();
      if (query.closeInitiator && !INITIATORS.has(query.closeInitiator))
        throw new Error();
      if ((query.q?.length ?? 0) > 100) throw new Error();
      const result = ctx.database.websocketConnectionLog.query({
        since: from ?? Date.now() - RANGES[range],
        until: to,
        outcome: query.outcome as ConnectionOutcome | undefined,
        accountId: query.accountId,
        query: query.q?.trim() || undefined,
        closeInitiator: query.closeInitiator as
          "client" | "upstream" | "gateway" | undefined,
        handshakeHttpStatus,
        clientCloseCode,
        upstreamCloseCode,
        cursor: decodeCursor(query.cursor),
        page,
        limit,
      });
      return {
        ...result,
        nextCursor: result.nextCursor
          ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url")
          : null,
      };
    } catch {
      return reply
        .code(400)
        .send({ error: "invalid_websocket_connection_log_query" });
    }
  });
}
