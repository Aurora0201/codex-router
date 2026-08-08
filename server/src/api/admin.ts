import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GatewayConfig } from "../types.js";
import { AccountService } from "../accounts/account-service.js";
import { GatewayDatabase } from "../db/database.js";
import { CsrfGuard } from "../security/csrf.js";

interface AdminApiOptions {
  config: GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
  csrf: CsrfGuard;
  startedAt: number;
}

function jsonBody(request: FastifyRequest): Record<string, unknown> {
  if (!Buffer.isBuffer(request.body)) throw new Error("invalid_json_body");
  try {
    const parsed = JSON.parse(request.body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json_body");
  }
}

async function requireCsrf(request: FastifyRequest, reply: FastifyReply, csrf: CsrfGuard): Promise<void> {
  if (!csrf.verify(request)) await reply.code(403).send({ error: "csrf_validation_failed" });
}

function publicAccount(account: ReturnType<AccountService["list"]>[number]) {
  const { codexHome: _codexHome, ...safe } = account;
  return safe;
}

function statusForError(error: Error): number {
  if (error.message.endsWith("_not_found")) return 404;
  if (error.message.startsWith("invalid_") || error.message === "unsupported_setting") return 400;
  if (error.message.includes("active") || error.message.includes("not_ready") || error.message.includes("fedramp")) return 409;
  return 500;
}

async function apiAction(reply: FastifyReply, operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    const result = await operation();
    if (result === undefined) await reply.code(204).send();
    else await reply.send(result);
  } catch (error) {
    await reply.code(statusForError(error as Error)).send({ error: (error as Error).message });
  }
}

export async function registerAdminApi(app: FastifyInstance, options: AdminApiOptions): Promise<void> {
  const protect = (request: FastifyRequest, reply: FastifyReply) => requireCsrf(request, reply, options.csrf);

  app.get("/api/health", async (_request, reply) => {
    const token = options.csrf.issue(reply);
    return {
      status: "ok",
      upstream: "configured",
      accounts: options.database.listAccounts().length,
      csrfToken: token,
      version: "0.1.0",
    };
  });

  app.get("/api/accounts", async () => options.accounts.list().map(publicAccount));

  app.post("/api/accounts/login", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    await apiAction(reply, () => options.accounts.startBrowserLogin(String(body.label ?? "")));
  });

  app.get<{ Params: { loginId: string } }>("/api/accounts/login/:loginId/status", async (request, reply) => {
    await apiAction(reply, () => options.accounts.getLoginStatus(request.params.loginId));
  });

  app.delete<{ Params: { loginId: string } }>("/api/accounts/login/:loginId", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => options.accounts.cancelLogin(request.params.loginId));
  });

  app.patch<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    await apiAction(reply, () => publicAccount(options.accounts.update(request.params.id, {
      ...(body.label === undefined ? {} : { label: String(body.label) }),
      ...(body.enabled === undefined ? {} : { enabled: Boolean(body.enabled) }),
    })));
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => options.accounts.remove(request.params.id));
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/set-default", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => publicAccount(options.accounts.setDefault(request.params.id)));
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-auth", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await options.accounts.refreshAuth(request.params.id);
      return publicAccount(options.database.getAccount(request.params.id)!);
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-limits", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await options.accounts.refreshRateLimits(request.params.id);
      return publicAccount(options.database.getAccount(request.params.id)!);
    });
  });

  app.get("/api/sessions", async () => options.database.listSessions());
  app.post<{ Params: { id: string } }>("/api/sessions/:id/release", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => options.database.releaseSession(request.params.id));
  });

  app.get("/api/settings", async () => ({
    ...options.database.getSettings(),
    gatewayAddress: options.config.host,
    gatewayPort: options.config.port,
    upstream: options.config.upstreamBaseUrl,
    promptLogging: false,
  }));
  app.patch("/api/settings", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => options.database.updateSettings(jsonBody(request)));
  });

  app.get("/api/stats", async () => options.database.getStats(options.startedAt));
}
