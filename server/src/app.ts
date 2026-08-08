import { access } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { GatewayConfig } from "./types.js";
import { loadConfig } from "./config.js";
import { AccountService } from "./accounts/account-service.js";
import { registerAdminApi } from "./api/admin.js";
import { GatewayDatabase } from "./db/database.js";
import { HttpProxy } from "./proxy/http-proxy.js";
import { registerWebSocketProxy } from "./proxy/ws-proxy.js";
import { AccountSelector } from "./routing/account-selector.js";
import { CsrfGuard } from "./security/csrf.js";

export interface GatewayApp {
  app: FastifyInstance;
  config: GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
}

export async function buildGateway(overrides: Partial<GatewayConfig> = {}): Promise<GatewayApp> {
  const config = loadConfig(overrides);
  const startedAt = Date.now();
  const app = Fastify({
    bodyLimit: config.requestBodyLimit,
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
  const accounts = new AccountService(config, database);
  const selector = new AccountSelector(database);
  const csrf = new CsrfGuard();
  const proxy = new HttpProxy({ upstreamBaseUrl: config.upstreamBaseUrl, accounts, selector, database });
  const rateLimitTimer = setInterval(() => {
    for (const account of accounts.list().filter((item) => item.enabled && item.authStatus === "ready")) {
      void accounts.refreshRateLimits(account.id).catch(() => undefined);
    }
  }, 5 * 60_000);
  rateLimitTimer.unref();

  await registerAdminApi(app, { config, database, accounts, csrf, startedAt });
  await registerWebSocketProxy(app, { upstreamBaseUrl: config.upstreamBaseUrl, accounts, selector, database });

  app.post("/backend-api/codex/responses", (request, reply) => proxy.handle(request, reply, "/responses"));
  app.post("/backend-api/codex/responses/compact", (request, reply) => proxy.handle(request, reply, "/responses/compact"));
  app.get("/backend-api/codex/models", (request, reply) => proxy.handle(request, reply, "/models"));
  app.all("/backend-api/codex/*", async (_request, reply) => {
    await reply.code(501).send({ error: "unsupported_codex_gateway_route" });
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

  let closed = false;
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    clearInterval(rateLimitTimer);
    await accounts.close();
    database.close();
  });

  return { app, config, database, accounts };
}
