import type { AppServerClient } from "./app-server-client.js";

/** A model the user can pick for the warm-up turn. */
export interface WarmupModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  /** Which reasoning efforts this model takes, in the catalog's own order. */
  efforts: { id: string; description: string }[];
  defaultEffort: string | null;
}

const TURN_TIMEOUT_MS = 90_000;

/**
 * Upstream messages can carry prompt or response text, which never reaches the
 * database. What is stored is a classification, the same way a failed status
 * check stores one.
 */
export function safeWarmupError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/unauthor|\b401\b|relogin|refresh.?token|login.?required/.test(message)) return "relogin_required";
  if (/\b429\b|rate.?limit|quota|usage.?limit/.test(message)) return "rate_limited";
  if (/timeout|timed out/.test(message)) return "timeout";
  if (/model/.test(message)) return "model_unavailable";
  if (/codex_app_server_(exited|closed|not_started)/.test(message)) return "app_server_unavailable";
  return "warmup_failed";
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export async function listWarmupModels(client: AppServerClient): Promise<WarmupModel[]> {
  const result = object(await client.call("model/list", { includeHidden: false }, 30_000));
  const data = Array.isArray(result.data) ? result.data : [];
  return data
    .map((entry) => {
      const model = object(entry);
      const id = typeof model.id === "string" ? model.id : "";
      const efforts = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
      return {
        id,
        displayName: typeof model.displayName === "string" ? model.displayName : id,
        isDefault: model.isDefault === true,
        efforts: efforts
          .map((value) => {
            const effort = object(value);
            return {
              id: typeof effort.reasoningEffort === "string" ? effort.reasoningEffort : "",
              description: typeof effort.description === "string" ? effort.description : "",
            };
          })
          .filter((effort) => effort.id.length > 0),
        defaultEffort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
      };
    })
    .filter((model) => model.id.length > 0);
}

/** thread/start, then one turn, then wait for the turn to come back. */
export async function sendWarmupTurn(
  client: AppServerClient,
  settings: { model: string | null; effort: string | null; message: string },
  cwd: string,
): Promise<string | null> {
  const { model, effort, message } = settings;
  const thread = object(
    await client.call(
      "thread/start",
      {
        ...(model ? { model } : {}),
        // A model this subscription cannot use falls back to the account's own
        // default rather than failing the warm-up over a picker choice.
        allowProviderModelFallback: true,
        cwd,
        sandbox: "read-only",
        approvalPolicy: "never",
      },
      60_000,
    ),
  );
  const threadId = typeof thread.threadId === "string" ? thread.threadId : String(object(thread.thread).id ?? "");
  if (!threadId) throw new Error("warmup_thread_not_started");

  const waiting = awaitTurn(client, threadId);
  let turnId: string | null = null;
  try {
    const started = object(
      await client.call(
        "turn/start",
        {
          threadId,
          input: [{ type: "text", text: message }],
          // Overrides the thread's effort for this turn. Omitted leaves the
          // model's own default, which is what "跟随模型默认" means.
          ...(effort ? { effort } : {}),
        },
        60_000,
      ),
    );
    const turn = object(started.turn);
    turnId = typeof turn.id === "string" ? turn.id : null;
    const usedModel = typeof started.model === "string" ? started.model : null;
    await waiting.completed;
    return usedModel ?? model;
  } catch (error) {
    // Giving up on a turn does not stop it: it keeps running upstream, and
    // goes on spending on an account nobody is watching any more.
    if (turnId) await client.call("turn/interrupt", { threadId, turnId }, 10_000).catch(() => undefined);
    throw error;
  } finally {
    waiting.cancel();
    // Whatever happened, do not leave the thread holding the app-server open.
    await client.call("thread/archive", { threadId }, 10_000).catch(() => undefined);
  }
}

/**
 * `turn/start` returns as soon as the turn exists; completion arrives as a
 * notification, and a failed turn arrives on that same notification with a
 * status rather than as an error.
 *
 * `cancel` matters as much as the promise. When `turn/start` itself fails
 * nobody is left awaiting this, and a rejection surfacing a minute and a half
 * later with no handler is not something a gateway should produce.
 */
function awaitTurn(client: AppServerClient, threadId: string): { completed: Promise<void>; cancel(): void } {
  let settle: () => void = () => undefined;
  const completed = new Promise<void>((resolve, reject) => {
    const listener = (method: string, params: unknown) => {
      if (method !== "turn/completed") return;
      const payload = object(params);
      if (payload.threadId !== threadId) return;
      settle();
      const turn = object(payload.turn);
      if (turn.status === "completed") resolve();
      else reject(new Error(`warmup_turn_${String(turn.status ?? "unknown")}`));
    };
    const timer = setTimeout(() => {
      settle();
      reject(new Error("warmup_turn_timeout"));
    }, TURN_TIMEOUT_MS);
    settle = () => {
      clearTimeout(timer);
      client.off("notification", listener);
    };
    client.on("notification", listener);
  });
  // Marks the rejection handled without taking it from whoever does await it.
  completed.catch(() => undefined);
  return { completed, cancel: () => settle() };
}
