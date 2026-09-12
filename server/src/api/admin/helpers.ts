import type { FastifyReply, FastifyRequest } from "fastify";
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

async function requireCsrf(request: FastifyRequest, reply: FastifyReply, csrf: CsrfGuard): Promise<void> {
  if (!csrf.verify(request)) await reply.code(403).send({ error: "csrf_validation_failed" });
}


// Only application-owned codes cross the admin boundary. RPC and filesystem
// messages can contain private data and must never be returned or logged here.
const ERROR_STATUS = new Map<string, number>([
  ["account_not_found", 404], ["login_not_found", 404], ["codex_config_not_found", 404],
  ["invalid_json_body", 400], ["invalid_request", 400], ["invalid_setting", 400],
  ["invalid_request_log_query", 400], ["unsupported_setting", 400],
  ["account_already_exists", 409], ["account_disabled", 409], ["account_not_ready", 409],
  ["no_active_account_selected", 409], ["fedramp_accounts_not_supported", 409],
  ["account_removal_in_progress", 409], ["account_relogin_required", 409],
  ["account_removal_failed", 500], ["account_login_start_failed", 500],
  ["codex_config_backup_missing", 500], ["rate_limit_reset_unknown_outcome", 500],
  ["codex_auth_file_incompatible", 500], ["codex_auth_file_too_large", 500],
  ["account_status_service_closed", 503], ["account_login_service_closed", 503],
  ["warmup_already_running", 409], ["warmup_service_closed", 503],
]);

function apiError(error: unknown): { code: string; status: number } {
  if (error instanceof Error) {
    const status = ERROR_STATUS.get(error.message);
    if (status !== undefined) return { code: error.message, status };
    const framework = error as Error & { code?: string; statusCode?: number };
    if (/^FST_ERR_[A-Z_]+$/.test(framework.code ?? "")
      && Number.isInteger(framework.statusCode) && framework.statusCode! >= 400 && framework.statusCode! < 500) {
      return { code: framework.code!, status: framework.statusCode! };
    }
  }
  return { code: "internal_error", status: 500 };
}

export function statusForError(error: unknown): number {
  return apiError(error).status;
}

export async function sendApiError(reply: FastifyReply, error: unknown): Promise<void> {
  const { status, code } = apiError(error);
  await reply.code(status).send({ error: code });
}

export async function apiAction(reply: FastifyReply, operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    const result = await operation();
    if (result === undefined) await reply.code(204).send();
    else await reply.send(result);
  } catch (error) {
    await sendApiError(reply, error);
  }
}

export function csrfProtect(csrf: CsrfGuard) {
  return (request: FastifyRequest, reply: FastifyReply) => requireCsrf(request, reply, csrf);
}
