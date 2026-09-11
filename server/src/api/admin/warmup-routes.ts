import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";
import { longWindowExhausted, longWindowResetsAt, shortWindowResetsAt, shortWindowRunning } from "../../accounts/account-warmup-service.js";

function readEnrollment(body: unknown): Record<string, boolean> {
  if (typeof body !== "object" || body === null) throw new Error("invalid_request");
  const input = (body as { enrolled?: unknown }).enrolled;
  if (typeof input !== "object" || input === null) throw new Error("invalid_request");
  const enrolled: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== "boolean") throw new Error("invalid_request");
    enrolled[id] = value;
  }
  return enrolled;
}

function readRunInput(body: unknown): { force: boolean; accountIds: string[] | undefined } {
  if (body === undefined || body === null) return { force: false, accountIds: undefined };
  if (typeof body !== "object") throw new Error("invalid_request");
  const input = body as { force?: unknown; accountIds?: unknown };
  if (input.force !== undefined && typeof input.force !== "boolean") throw new Error("invalid_request");
  let accountIds: string[] | undefined;
  if (input.accountIds !== undefined) {
    if (!Array.isArray(input.accountIds)) throw new Error("invalid_request");
    accountIds = input.accountIds.map((id) => {
      if (typeof id !== "string" || id.length === 0) throw new Error("invalid_request");
      return id;
    });
  }
  return { force: input.force === true, accountIds };
}

export function registerWarmupRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/warmup", async () => {
    const now = Date.now();
    return {
      settings: ctx.database.settings.warmup(),
      progress: ctx.warmup.currentProgress(),
      // Every account, with the one reading the decision turns on: a window
      // that is still counting is a warm-up that would buy nothing.
      accounts: ctx.database.accounts.list().map((account) => ({
        id: account.id,
        enrolled: account.warmupEnrolled,
        eligible: account.enabled && account.authStatus === "ready",
        windowResetsAt: shortWindowResetsAt(account),
        windowRunning: shortWindowRunning(account, now),
        // Said separately from `eligible`: the account itself is fine, it has
        // just spent its week, and the console should say when that ends
        // rather than call it unavailable.
        weeklyExhausted: longWindowExhausted(account, now),
        weeklyResetsAt: longWindowResetsAt(account),
      })),
      recent: ctx.database.warmupLog.recent(20),
    };
  });

  app.get("/api/warmup/models", async (_request, reply) => {
    // Separate from the read above because it spawns an app-server, which the
    // sheet should not have to wait on before it can draw anything.
    await apiAction(reply, async () => ({ models: await ctx.warmup.models() }));
  });

  app.patch("/api/warmup", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const body = jsonBody(request);
      if (typeof body !== "object" || body === null) throw new Error("invalid_request");
      const settings = ctx.database.settings.patchWarmup(body);
      ctx.events.invalidate("settings", "warmup");
      return settings;
    });
  });

  app.patch("/api/warmup/enrollment", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const enrolled = readEnrollment(jsonBody(request));
      const known = new Set(ctx.database.accounts.list().map((account) => account.id));
      for (const id of Object.keys(enrolled)) if (!known.has(id)) throw new Error("account_not_found");
      for (const [id, value] of Object.entries(enrolled)) {
        ctx.database.accounts.update(id, { warmupEnrolled: value });
      }
      ctx.events.invalidate("accounts", "warmup");
      return { enrolled };
    });
  });

  app.post("/api/warmup/run", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const { force, accountIds } = readRunInput(request.body === undefined ? undefined : jsonBody(request));
      if (ctx.warmup.isRunning()) throw new Error("warmup_already_running");
      const targets = accountIds
        ? ctx.warmup.candidates().filter((account) => accountIds.includes(account.id))
        : force
          ? ctx.warmup.candidates()
          : ctx.warmup.pending();
      // Answering before the run finishes: a turn per account is tens of
      // seconds, and progress belongs on the event stream rather than in a
      // request the console has to hold open.
      void ctx.runWarmup({ trigger: "manual", force, accountIds });
      return { started: true, total: targets.length };
    });
  });
}
