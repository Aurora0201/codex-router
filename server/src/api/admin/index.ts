import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { registerHealthRoutes } from "./health-routes.js";
import { registerAccountRoutes } from "./account-routes.js";
import { registerAccountLoginRoutes } from "./account-login-routes.js";
import { registerActiveAccountRoutes } from "./active-account-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerStatsRoutes } from "./stats-routes.js";
import { registerCodexRoutes } from "./codex-routes.js";
import { CodexConfigService } from "../../codex/codex-config.js";
import { registerAdminEventRoutes } from "./admin-events.js";
import { registerRequestLogRoutes } from "./request-log-routes.js";
import { registerWebSocketConnectionRoutes } from "./websocket-connection-routes.js";
import { registerWebSocketConnectionLogRoutes } from "./websocket-connection-log-routes.js";

export async function registerAdminApi(
  app: FastifyInstance,
  ctx: AdminContext,
  codexConfig: CodexConfigService,
): Promise<void> {
  registerHealthRoutes(app, ctx);
  registerAdminEventRoutes(app, ctx.events);
  registerAccountRoutes(app, ctx);
  registerAccountLoginRoutes(app, ctx);
  registerActiveAccountRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerRequestLogRoutes(app, ctx);
  registerCodexRoutes(app, ctx, codexConfig);
  registerWebSocketConnectionRoutes(app, ctx);
  registerWebSocketConnectionLogRoutes(app, ctx);
}

export type { AdminContext } from "./context.js";
export { toAccountView } from "./context.js";
export { statusForError } from "./helpers.js";
