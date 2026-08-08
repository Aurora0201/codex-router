import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountRecord } from "../../types.js";
import type { CsrfGuard } from "../../security/csrf.js";

export function jsonBody(request: FastifyRequest): Record<string, unknown> {
  if (!Buffer.isBuffer(request.body)) throw new Error("invalid_json_body");
  try {
    const parsed = JSON.parse(request.body.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json_body");
  }
}

export async function requireCsrf(request: FastifyRequest, reply: FastifyReply, csrf: CsrfGuard): Promise<void> {
  if (!csrf.verify(request)) await reply.code(403).send({ error: "csrf_validation_failed" });
}

export function publicAccount(account: AccountRecord) {
  const { codexHome: _codexHome, ...safe } = account;
  return safe;
}

export function statusForError(error: Error): number {
  if (error.message.endsWith("_not_found")) return 404;
  if (error.message.startsWith("invalid_") || error.message === "unsupported_setting") return 400;
  if (error.message === "account_already_exists") return 409;
  if (error.message === "no_active_account_selected") return 409;
  if (error.message.includes("active") || error.message.includes("not_ready") || error.message.includes("fedramp")) return 409;
  return 500;
}

export async function apiAction(reply: FastifyReply, operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    const result = await operation();
    if (result === undefined) await reply.code(204).send();
    else await reply.send(result);
  } catch (error) {
    await reply.code(statusForError(error as Error)).send({ error: (error as Error).message });
  }
}

export function csrfProtect(csrf: CsrfGuard) {
  return (request: FastifyRequest, reply: FastifyReply) => requireCsrf(request, reply, csrf);
}
