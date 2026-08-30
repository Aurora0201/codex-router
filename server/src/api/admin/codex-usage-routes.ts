import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import type { CodexUsageRange } from "../../codex/codex-usage-service.js";

const ranges = new Set<CodexUsageRange>(["1d", "7d", "14d", "30d", "90d", "all"]);

export function registerCodexUsageRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get<{ Querystring: { range?: string; model?: string; project?: string } }>("/api/codex-usage", async (request, reply) => {
    const range = request.query.range ?? "14d";
    if (!ranges.has(range as CodexUsageRange)) return reply.code(400).send({ error: "invalid_usage_range" });
    if ((request.query.model?.length ?? 0) > 200 || (request.query.project?.length ?? 0) > 128) {
      return reply.code(400).send({ error: "invalid_usage_filter" });
    }
    return ctx.codexUsage.getDashboard({ range: range as CodexUsageRange, model: request.query.model, project: request.query.project });
  });
}
