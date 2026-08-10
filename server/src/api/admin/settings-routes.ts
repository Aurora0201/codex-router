import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

export function registerSettingsRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/settings", async () => ({
    ...ctx.database.settings.get(),
    gatewayAddress: ctx.config.host,
    gatewayPort: ctx.config.port,
    upstream: ctx.config.upstreamBaseUrl,
    promptLogging: false,
  }));

  app.patch("/api/settings", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const result = ctx.database.settings.update(jsonBody(request));
      ctx.events.invalidate("settings");
      return result;
    });
  });
}
