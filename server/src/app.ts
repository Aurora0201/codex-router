import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { GatewayConfig } from "./types.js";
import { loadConfig } from "./config.js";
import { AccountService } from "./accounts/account-service.js";
import { AccountLoginService } from "./accounts/account-login-service.js";
import { AccountAuthService } from "./accounts/account-auth-service.js";
import { AccountUsageService } from "./accounts/account-usage-service.js";
import { CredentialReader } from "./accounts/credential-reader.js";
import { GatewayDatabase } from "./db/database.js";
import { HttpProxy } from "./proxy/http-proxy.js";
import { registerWebSocketProxy } from "./proxy/ws-proxy.js";
import { ActiveAccountService } from "./routing/active-account-service.js";
import { registerAdminApi } from "./api/admin/index.js";
import { CsrfGuard } from "./security/csrf.js";
import { CodexConfigService } from "./codex/codex-config.js";
import { CodexProcessMonitor } from "./codex/codex-process.js";
import { AdminEventHub } from "./api/admin/admin-events.js";
import { LOG_LEVELS } from "./db/repositories/settings-repository.js";

export interface GatewayApp {
  app: FastifyInstance;
  config: GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
  logins: AccountLoginService;
  activeAccounts: ActiveAccountService;
  auth: AccountAuthService;
  usage: AccountUsageService;
}

function startUsageRefreshScheduler(accounts: AccountService, usage: AccountUsageService, onRefresh: () => void): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const account of accounts.list().filter((item) => item.enabled && item.authStatus === "ready")) {
      void usage.refresh(account.id).then(onRefresh).catch(() => undefined);
    }
  }, 5 * 60_000);
  timer.unref();
  return timer;
}

async function backfillChatgptAccountIds(database: GatewayDatabase): Promise<void> {
  const reader = new CredentialReader();
  for (const account of database.accounts.list()) {
    if (account.chatgptAccountId) continue;
    try {
      const credential = await reader.read(account.codexHome);
      if (credential.fedRamp) {
        database.accounts.update(account.id, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
      } else {
        database.accounts.update(account.id, { chatgptAccountId: credential.accountId, email: credential.email, planType: credential.planType });
      }
    } catch {
      // Do not guess an identifier; mark the account as requiring re-login instead.
      database.accounts.update(account.id, { authStatus: "relogin_required", enabled: false });
    }
  }
}

export async function buildGateway(overrides: Partial<GatewayConfig> = {}): Promise<GatewayApp> {
  const config = loadConfig(overrides);
  const startedAt = Date.now();
  const app = Fastify({
    bodyLimit: config.requestBodyLimit,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    logger: {
      level: process.env.GATEWAY_LOG_LEVEL ?? "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.chatgpt-account-id",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "authorization",
          "access_token",
          "refresh_token",
          "id_token",
        ],
        censor: "[REDACTED]",
      },
    },
  });
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  const database = new GatewayDatabase(config.databasePath);
  const environmentLogLevel = process.env.GATEWAY_LOG_LEVEL;
  if (environmentLogLevel && LOG_LEVELS.includes(environmentLogLevel as (typeof LOG_LEVELS)[number])) {
    database.settings.update({ logLevel: environmentLogLevel });
  } else if (!environmentLogLevel) {
    const persistedLogLevel = database.settings.get().logLevel;
    if (typeof persistedLogLevel === "string") app.log.level = persistedLogLevel;
  }
  await backfillChatgptAccountIds(database);
  const activeAccounts = new ActiveAccountService(database);
  const accounts = new AccountService(config, database, activeAccounts);
  const logins = new AccountLoginService(config, database);
  const auth = new AccountAuthService(config, database);
  const usage = new AccountUsageService(config, database);
  const csrf = new CsrfGuard();
  const proxy = new HttpProxy({ upstreamBaseUrl: config.upstreamBaseUrl, activeAccounts, auth, usage, database });
  const codexConfig = new CodexConfigService();
  const events = new AdminEventHub();
  const rateLimitTimer = startUsageRefreshScheduler(accounts, usage, () => events.invalidate("accounts"));
  const codexProcess = new CodexProcessMonitor(() => events.invalidate("codex"));
  await codexProcess.start();
  database.requestLog.onLogged = () => events.invalidate("stats", "logs");

  await registerAdminApi(app, { config, database, accounts, auth, usage, logins, activeAccounts, csrf, startedAt, events, codexProcess }, codexConfig);
  await registerWebSocketProxy(app, { upstreamBaseUrl: config.upstreamBaseUrl, activeAccounts, auth, database });

  app.post("/backend-api/codex/responses", (request, reply) => proxy.handle(request, reply, "/responses"));
  app.post("/backend-api/codex/responses/compact", (request, reply) => proxy.handle(request, reply, "/responses/compact"));
  app.get("/backend-api/codex/models", (request, reply) => proxy.handle(request, reply, "/models"));
  app.post("/backend-api/codex/alpha/search", (request, reply) => proxy.handle(request, reply, "/alpha/search"));
  app.all("/backend-api/codex/*", async (_request, reply) => {
    await reply.code(501).send({ error: "unsupported_codex_router_route" });
  });

  try {
    await access(config.webDistDir);
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: "/admin/",
      decorateReply: false,
      index: "index.html",
    });
    app.get("/admin", async (_request, reply) => reply.redirect("/admin/"));
  } catch {
    app.get("/admin", async (_request, reply) => reply.code(503).send({ error: "admin_ui_not_built", hint: "Run npm run build" }));
  }

  app.get("/admin-v2", async (_request, reply) => reply.redirect("/admin/"));
  app.get("/admin-v2/", async (_request, reply) => reply.redirect("/admin/"));

  let closed = false;
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    clearInterval(rateLimitTimer);
    codexProcess.close();
    events.close();
    await logins.close();
    database.close();
  });

  return { app, config, database, accounts, logins, activeAccounts, auth, usage };
}
