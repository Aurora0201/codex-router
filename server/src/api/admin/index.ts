import type { FastifyInstance } from "fastify";
import { sendApiError } from "./helpers.js";
import type { AdminContext } from "./context.js";
import { registerHealthRoutes } from "./health-routes.js";
import { registerAccountRoutes } from "./account-routes.js";
import { registerAccountLoginRoutes } from "./account-login-routes.js";
import { registerActiveAccountRoutes } from "./active-account-routes.js";
import { registerAutoSwitchRoutes } from "./auto-switch-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerStatsRoutes } from "./stats-routes.js";
import { registerCodexRoutes } from "./codex-routes.js";
import { CodexConfigService } from "../../codex/codex-config.js";
import { registerAdminEventRoutes } from "./admin-events.js";
import { registerRequestLogRoutes } from "./request-log-routes.js";
import { registerWebSocketConnectionRoutes } from "./websocket-connection-routes.js";
import { registerWebSocketConnectionLogRoutes } from "./websocket-connection-log-routes.js";
import { registerCodexUsageRoutes } from "./codex-usage-routes.js";

export async function registerAdminApi(
  app: FastifyInstance,
  ctx: AdminContext,
  codexConfig: CodexConfigService,
): Promise<void> {
  await app.register(async (admin) => {
    admin.setErrorHandler((error, _request, reply) => sendApiError(reply, error));
    registerHealthRoutes(admin, ctx);
    registerAdminEventRoutes(admin, ctx.events);
    registerAccountRoutes(admin, ctx);
    registerAccountLoginRoutes(admin, ctx);
    registerActiveAccountRoutes(admin, ctx);
    registerSettingsRoutes(admin, ctx);
    registerAutoSwitchRoutes(admin, ctx);
    registerStatsRoutes(admin, ctx);
    registerRequestLogRoutes(admin, ctx);
    registerCodexRoutes(admin, ctx, codexConfig);
    registerWebSocketConnectionRoutes(admin, ctx);
    registerWebSocketConnectionLogRoutes(admin, ctx);
    registerCodexUsageRoutes(admin, ctx);
  });
}

export type { AdminContext } from "./context.js";
export { toAccountView } from "./context.js";
export { statusForError } from "./helpers.js";
