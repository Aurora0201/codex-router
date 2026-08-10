import type { FastifyInstance } from "fastify";
import type { Transport } from "../../types.js";
import type { AdminContext } from "./context.js";

const TRANSPORTS = new Set<Transport>(["http", "ws", "compact", "models", "search"]);
const RANGES: Record<string, number> = { "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 };

function decodeCursor(value: string | undefined): { createdAt: number; id: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "number" || typeof parsed.id !== "string") throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error("invalid_request_log_query");
  }
}

export function registerRequestLogRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/request-logs", async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const range = query.range ?? "24h";
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const status = query.status;
      const transport = query.transport;
      if (!RANGES[range] || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error();
      if (status && status !== "success" && status !== "error") throw new Error();
      if (transport && !TRANSPORTS.has(transport as Transport)) throw new Error();
      if ((query.q?.length ?? 0) > 100) throw new Error();
      const result = ctx.database.requestLog.query({
        since: Date.now() - RANGES[range],
        status: status as "success" | "error" | undefined,
        transport: transport as Transport | undefined,
        accountId: query.accountId,
        query: query.q?.trim() || undefined,
        cursor: decodeCursor(query.cursor),
        limit,
      });
      return {
        ...result,
        nextCursor: result.nextCursor
          ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url")
          : null,
      };
    } catch {
      return reply.code(400).send({ error: "invalid_request_log_query" });
    }
  });
}
