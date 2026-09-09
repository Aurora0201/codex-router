import { randomUUID } from "node:crypto";
import pino from "pino";
import { access } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { GatewayConfig } from "./types.js";
import { loadConfig } from "./config.js";
import { AccountOperationLock } from "./accounts/account-lock.js";
import { AccountService } from "./accounts/account-service.js";
import { AccountLoginService } from "./accounts/account-login-service.js";
import { AccountWarmupService } from "./accounts/account-warmup-service.js";
import { AccountAuthService } from "./accounts/account-auth-service.js";
import { AccountUsageService } from "./accounts/account-usage-service.js";
import { AccountStatusService } from "./accounts/account-status-service.js";
import { CredentialReader } from "./accounts/credential-reader.js";
import { GatewayDatabase } from "./db/database.js";
import { HttpProxy } from "./proxy/http-proxy.js";
import { AutoSwitchService } from "./routing/auto-switch-service.js";
import { registerLocalStatusRoutes } from "./api/local/status-routes.js";
import { registerWebSocketProxy } from "./proxy/ws-proxy.js";
import { ActiveAccountService } from "./routing/active-account-service.js";
import { registerAdminApi } from "./api/admin/index.js";
import { CsrfGuard } from "./security/csrf.js";
import { CodexConfigService } from "./codex/codex-config.js";
import { CodexProcessMonitor } from "./codex/codex-process.js";
import { AdminEventHub } from "./api/admin/admin-events.js";
import { LOG_LEVELS } from "./db/repositories/settings-repository.js";
import { WebSocketConnectionRegistry } from "./proxy/websocket-connection-registry.js";
import { CodexUsageService } from "./codex/codex-usage-service.js";

export interface GatewayApp {
  app: FastifyInstance;
  config: GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
  logins: AccountLoginService;
  activeAccounts: ActiveAccountService;
  auth: AccountAuthService;
  usage: AccountUsageService;
  accountStatus: AccountStatusService;
  codexUsage: CodexUsageService;
}

export interface GatewayBuildOptions {
  backgroundTasks?: boolean;
}

function startUsageRefreshScheduler(status: AccountStatusService): NodeJS.Timeout {
  const refreshAccounts = () => {
    void status.refreshAll();
  };
  refreshAccounts();
  const timer = setInterval(refreshAccounts, 5 * 60_000);
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

export async function buildGateway(overrides: Partial<GatewayConfig> = {}, options: GatewayBuildOptions = {}): Promise<GatewayApp> {
  const config = loadConfig(overrides);
  const backgroundTasks = options.backgroundTasks ?? true;
  const startedAt = Date.now();
  // Writing the file here rather than having the caller redirect a stream into
  // it keeps every shell out of the log's path. A scheduled task redirecting
  // with `*>>` wrote it in UTF-16, and piping through Out-File wraps anything
  // on stderr in a PowerShell error record.
  const logStream = config.logFilePath
    // Synchronous: a buffered destination loses whatever it was holding when
    // the process dies, and the lines around a crash are the ones worth having.
    // This gateway writes a few hundred lines a day.
    ? pino.destination({ dest: config.logFilePath, append: true, mkdir: true, sync: true })
    : undefined;
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
      ...(logStream ? { stream: logStream } : {}),
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
  const accountOperations = new AccountOperationLock();
  const accounts = new AccountService(config, database, activeAccounts, accountOperations);
  const logins = new AccountLoginService(config, database);
  await logins.cleanupStaleStaging();
  // Credentials a half-finished login left behind. Swept here because no login
  // can be in flight yet, which is what makes "has no row" mean "is garbage".
  const orphans = await accounts.cleanupOrphanDirectories();
  if (orphans.length > 0) app.log.info({ count: orphans.length }, "orphan_account_directories_removed");
  const csrf = new CsrfGuard();
  const events = new AdminEventHub();
  const autoSwitch = new AutoSwitchService(database, activeAccounts);
  const reEvaluateRouting = (trigger: Parameters<AutoSwitchService["evaluate"]>[0]) => {
    try {
      if (autoSwitch.evaluate(trigger)) events.invalidate("accounts");
    } catch (error) {
      app.log.warn({ err: error }, "auto_switch_evaluation_failed");
    }
  };
  /**
   * Assigned once the warm-up service exists. The cycle is real: the status
   * refresh is what reveals a lapsed window, and warming one needs the status
   * service to read the new window back.
   */
  let autoWarm: () => void = () => undefined;
  // Quota readings only change on a refresh, so that is the moment worth
  // re-deciding on — and a refresh that failed is the moment an account stops
  // being able to serve. The switch itself is the same select() a person
  // clicks.
  const accountStatus = new AccountStatusService(config, database, (accountId, ok) => {
    events.invalidate("accounts");
    const account = database.accounts.get(accountId);
    const routable = ok && account?.enabled === true && account.authStatus === "ready";
    reEvaluateRouting(routable ? { kind: "quota" } : { kind: "unavailable", accountId });
    autoWarm();
  }, accountOperations);
  const warmup = new AccountWarmupService(config, database, accountStatus, () => events.invalidate("warmup"));
  /**
   * A warm-up pass plus the reporting the service itself does not do. Quota
   * moves during a run, so the router is asked to look again once it is over —
   * otherwise routing could sit on an account the warm-up just pushed under a
   * threshold.
   */
  const runWarmup = async (options: { trigger: "manual" | "auto"; force?: boolean; accountIds?: string[] }): Promise<void> => {
    try {
      const result = await warmup.run(options);
      const warmed = result.results.filter((entry) => entry.outcome === "warmed").length;
      const failed = result.results.filter((entry) => entry.outcome === "failed").length;
      app.log.info({ trigger: options.trigger, warmed, failed, total: result.results.length }, "warmup_run_finished");
    } catch (error) {
      // A second run asked for while one is going is the caller's answer to
      // give, not something the gateway should fall over on.
      if ((error as Error).message !== "warmup_already_running") {
        app.log.warn({ err: error }, "warmup_run_failed");
      }
    } finally {
      events.invalidate("accounts", "warmup");
      reEvaluateRouting({ kind: "quota" });
    }
  };
  /**
   * A window that has lapsed is the moment worth warming, and a status refresh
   * is when that becomes visible — including the first refresh after a logon,
   * which is the case this exists for: the machine was off all night, so every
   * five-hour window expired long ago.
   *
   * It stays off unless it is turned on. This is the gateway spending the
   * user's quota without being asked each time, so the guards inside the
   * service — a per-account cooldown and a daily ceiling counted from the log
   * — are what keep a wrong decision from becoming an expensive one.
   */
  autoWarm = () => {
    if (!backgroundTasks || !database.settings.warmup().auto) return;
    if (warmup.isRunning() || warmup.autoTargets().length === 0) return;
    void runWarmup({ trigger: "auto" });
  };
  const auth = new AccountAuthService(database, accountStatus);
  const usage = new AccountUsageService(accountStatus, backgroundTasks);
  const proxy = new HttpProxy({
    upstreamBaseUrl: config.upstreamBaseUrl,
    activeAccounts, auth, usage, database,
    onRateLimited: (accountId) => reEvaluateRouting({ kind: "rate_limited", accountId }),
  });
  const codexConfig = new CodexConfigService();
  const codexUsage = await CodexUsageService.create({ dataDir: config.dataDir, legacyDb: database.raw, onChange: () => events.invalidate("usage"), log: app.log });
  if (backgroundTasks) codexUsage.start();
  const websocketConnections = new WebSocketConnectionRegistry((connectionId) => {
    events.emitActivity({ type: "connection_updated", connectionId });
    events.invalidate("websocketConnections");
  });
  const rateLimitTimer = backgroundTasks ? startUsageRefreshScheduler(accountStatus) : null;
  const codexProcess = new CodexProcessMonitor(() => events.invalidate("codex"));
  if (backgroundTasks) await codexProcess.start();
  database.requestLog.onStarted = (id) => { events.emitActivity({ type: "request_started", id }); events.invalidate("logs"); };
  database.requestLog.onFinished = (id) => { events.emitActivity({ type: "request_finished", id }); events.invalidate("stats", "logs"); };
  database.websocketConnectionLog.onUpdated = (connectionId) => { events.emitActivity({ type: "connection_updated", connectionId }); events.invalidate("logs"); };

  const adminContext = { config, database, accounts, auth, usage, accountStatus, autoSwitch, reEvaluateRouting, warmup, runWarmup, logins, activeAccounts, csrf, startedAt, events, codexProcess, websocketConnections, codexUsage };
  registerLocalStatusRoutes(app, adminContext);
  await registerAdminApi(app, adminContext, codexConfig);
  await registerWebSocketProxy(app, { upstreamBaseUrl: config.upstreamBaseUrl, activeAccounts, auth, usage, database, websocketConnections });

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

  // Before Fastify begins waiting on connections, not after: an event stream
  // stays open by design and would otherwise hold the shutdown until the CLI
  // gave up on it.
  app.addHook("preClose", async () => events.endStreams());

  let closed = false;
  // Fastify runs onClose only after the server has stopped accepting requests;
  // it is lifecycle cleanup, not an HTTP handler reachable by a client.
  // codeql[js/missing-rate-limiting]
  app.addHook("onClose", async () => {
    if (closed) return;
    closed = true;
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    await accountStatus.close();
    await codexProcess.close();
    await codexUsage.close();
    await logins.close();
    await proxy.close();
    events.close();
    database.close();
  });

  return { app, config, database, accounts, logins, activeAccounts, auth, usage, accountStatus, codexUsage };
}
