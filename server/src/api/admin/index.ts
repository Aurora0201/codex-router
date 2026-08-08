import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { registerHealthRoutes } from "./health-routes.js";
import { registerAccountRoutes } from "./account-routes.js";
import { registerAccountLoginRoutes } from "./account-login-routes.js";
import { registerActiveAccountRoutes } from "./active-account-routes.js";
import { registerSessionRoutes } from "./session-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerStatsRoutes } from "./stats-routes.js";
import { registerCodexRoutes } from "./codex-routes.js";
import { CodexConfigService } from "../../codex/codex-config.js";

export async function registerAdminApi(
  app: FastifyInstance,
  ctx: AdminContext,
  activity: { count(key: string): number },
  codexConfig: CodexConfigService,
): Promise<void> {
  registerHealthRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerAccountLoginRoutes(app, ctx);
  registerActiveAccountRoutes(app, ctx);
  registerSessionRoutes(app, ctx, activity);
  registerSettingsRoutes(app, ctx);
  registerStatsRoutes(app, ctx, activity);
  registerCodexRoutes(app, ctx, codexConfig);
}

export type { AdminContext } from "./context.js";
export { toAccountView } from "./context.js";
export { statusForError } from "./helpers.js";
