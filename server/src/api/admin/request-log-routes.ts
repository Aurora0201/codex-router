import type { FastifyInstance } from "fastify";
import type {
  FailureSource,
  FailureStage,
  RequestOutcome,
  RequestState,
  Transport,
} from "../../types.js";
import type { AdminContext } from "./context.js";

const TRANSPORTS = new Set<Transport>([
  "http",
  "ws",
  "compact",
  "models",
  "search",
]);
const RANGES: Record<string, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
};
const STATES = new Set<RequestState>([
  "running",
  "completed",
  "failed",
  "rejected",
  "cancelled",
  "interrupted",
]);
const OUTCOMES = new Set<RequestOutcome>([
  "success",
  "upstream_error",
  "gateway_error",
  "rejected",
  "client_cancelled",
]);
const SOURCES = new Set<FailureSource>([
  "gateway",
  "upstream_http",
  "upstream_protocol",
  "transport",
  "client",
]);
const STAGES = new Set<FailureStage>([
  "routing",
  "authentication",
  "handshake",
  "sending",
  "streaming",
  "terminal",
]);
const integer = (value: string | undefined) =>
  value === undefined ? undefined : Number(value);

function decodeCursor(
  value: string | undefined,
): { createdAt: number; id: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "number" || typeof parsed.id !== "string")
      throw new Error();
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error("invalid_request_log_query");
  }
}

export function registerRequestLogRoutes(
  app: FastifyInstance,
  ctx: AdminContext,
): void {
  app.get("/api/request-logs", async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const range = query.range ?? "24h";
      const limit = query.limit === undefined ? 50 : Number(query.limit);
      const page = query.page === undefined ? undefined : Number(query.page);
      const status = query.status;
      const transport = query.transport;
      const from = integer(query.from);
      const to = integer(query.to);
      const httpStatus = integer(query.httpStatus);
      if (
        !RANGES[range] ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new Error();
      if (
        (from !== undefined && !Number.isSafeInteger(from)) ||
        (to !== undefined && !Number.isSafeInteger(to)) ||
        (from !== undefined && to !== undefined && from > to)
      )
        throw new Error();
      if (
        httpStatus !== undefined &&
        (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)
      )
        throw new Error();
      if (page !== undefined && (!Number.isInteger(page) || page < 1))
        throw new Error();
      if (page !== undefined && query.cursor !== undefined) throw new Error();
      if (
        status &&
        !["success", "rejected", "error", "cancelled", "running"].includes(
          status,
        )
      )
        throw new Error();
      if (transport && !TRANSPORTS.has(transport as Transport))
        throw new Error();
      if (query.state && !STATES.has(query.state as RequestState))
        throw new Error();
      if (query.outcome && !OUTCOMES.has(query.outcome as RequestOutcome))
        throw new Error();
      if (
        query.failureSource &&
        !SOURCES.has(query.failureSource as FailureSource)
      )
        throw new Error();
      if (query.failureStage && !STAGES.has(query.failureStage as FailureStage))
        throw new Error();
      if (
        [query.q, query.protocolErrorCode, query.diagnosticCode].some(
          (value) => (value?.length ?? 0) > 100,
        )
      )
        throw new Error();
      const result = ctx.database.requestLog.query({
        since: from ?? Date.now() - RANGES[range],
        until: to,
        status: status as
          | "success"
          | "rejected"
          | "error"
          | "cancelled"
          | "running"
          | undefined,
        state: query.state as RequestState | undefined,
        outcome: query.outcome as RequestOutcome | undefined,
        failureSource: query.failureSource as FailureSource | undefined,
        failureStage: query.failureStage as FailureStage | undefined,
        httpStatus,
        protocolErrorCode: query.protocolErrorCode,
        diagnosticCode: query.diagnosticCode,
        transport: transport as Transport | undefined,
        accountId: query.accountId,
        query: query.q?.trim() || undefined,
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
      return reply.code(400).send({ error: "invalid_request_log_query" });
    }
  });
}
