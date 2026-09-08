import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

interface RankInput {
  /** Account ids in priority order; anything omitted keeps its own rank. */
  order?: unknown;
  /** Account id -> whether it takes part at all. */
  enrolled?: unknown;
}

function readRankInput(body: unknown): { order: string[]; enrolled: Record<string, boolean> } {
  if (typeof body !== "object" || body === null) throw new Error("invalid_request");
  const input = body as RankInput;
  const order: string[] = [];
  if (input.order !== undefined) {
    if (!Array.isArray(input.order)) throw new Error("invalid_request");
    for (const id of input.order) {
      if (typeof id !== "string" || id.length === 0) throw new Error("invalid_request");
      order.push(id);
    }
    if (new Set(order).size !== order.length) throw new Error("invalid_request");
  }
  const enrolled: Record<string, boolean> = {};
  if (input.enrolled !== undefined) {
    if (typeof input.enrolled !== "object" || input.enrolled === null) throw new Error("invalid_request");
    for (const [id, value] of Object.entries(input.enrolled as Record<string, unknown>)) {
      if (typeof value !== "boolean") throw new Error("invalid_request");
      enrolled[id] = value;
    }
  }
  return { order, enrolled };
}

export function registerAutoSwitchRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/auto-switch", async () => ({
    settings: ctx.database.settings.autoSwitch(),
    // The order the service would actually walk, so the console shows the
    // ranking that is in force rather than one it re-derives for itself.
    candidateIds: ctx.autoSwitch.candidates().map((account) => account.id),
    stalled: ctx.autoSwitch.stalled(),
    recent: ctx.database.accountSwitchLog.recent(20),
  }));

  app.patch("/api/auto-switch", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const body = jsonBody(request);
      if (typeof body !== "object" || body === null) throw new Error("invalid_request");
      // A patch, laid over what is stored. Replacing the row would reset every
      // field the console did not happen to send.
      const settings = ctx.database.settings.patchAutoSwitch(body);
      ctx.events.invalidate("settings", "accounts");
      // Arming it is itself a reason to look: waiting for the next sweep would
      // leave the routed account below the threshold the user just set.
      if (settings.enabled) ctx.reEvaluateRouting({ kind: "quota" });
      return settings;
    });
  });

  app.patch("/api/auto-switch/priority", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      const { order, enrolled } = readRankInput(jsonBody(request));
      const known = new Set(ctx.database.accounts.list().map((account) => account.id));
      for (const id of [...order, ...Object.keys(enrolled)]) {
        if (!known.has(id)) throw new Error("account_not_found");
      }
      order.forEach((id, index) => ctx.database.accounts.update(id, { autoSwitchRank: index }));
      for (const [id, value] of Object.entries(enrolled)) {
        ctx.database.accounts.update(id, { autoSwitchEnrolled: value });
      }
      ctx.events.invalidate("accounts");
      return { candidateIds: ctx.autoSwitch.candidates().map((account) => account.id) };
    });
  });
}
