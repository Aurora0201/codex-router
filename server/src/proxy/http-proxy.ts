import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { request as undiciRequest, type Dispatcher } from "undici";
import type { Transport } from "../types.js";
import { AccountAuthService } from "../accounts/account-auth-service.js";
import { AccountUsageService } from "../accounts/account-usage-service.js";
import { GatewayDatabase } from "../db/database.js";
import { ActiveAccountService } from "../routing/active-account-service.js";
import { hasBrowserOrigin } from "../security/origin-guard.js";
import { buildUpstreamHeaders, copyResponseHeaders } from "./headers.js";

interface HttpProxyOptions {
  upstreamBaseUrl: string;
  activeAccounts: ActiveAccountService;
  auth: AccountAuthService;
  usage: AccountUsageService;
  database: GatewayDatabase;
}

function errorStatus(error: unknown): number {
  switch ((error as Error).message) {
    case "no_active_account_selected": return 503;
    case "account_disabled":
    case "account_not_ready":
    case "fedramp_accounts_not_supported": return 409;
    default: return 502;
  }
}

function responseHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  return headers;
}

export class HttpProxy {
  constructor(private readonly options: HttpProxyOptions) {}

  async handle(request: FastifyRequest, reply: FastifyReply, path: "/responses" | "/responses/compact" | "/models"): Promise<void> {
    if (hasBrowserOrigin(request)) {
      await reply.code(403).send({ error: "browser_origin_not_allowed" });
      return;
    }

    const startedAt = Date.now();
    const rawBody = request.method === "GET" ? Buffer.alloc(0) : this.rawBody(request.body);
    const transport: Transport = path === "/models" ? "models" : path === "/responses/compact" ? "compact" : "http";

    try {
      const account = this.options.activeAccounts.get();
      if (!account) throw new Error("no_active_account_selected");
      if (account.fedRamp) throw new Error("fedramp_accounts_not_supported");
      let credential = await this.options.auth.getCredential(account.id);
      const controller = new AbortController();
      const abort = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      request.raw.once("aborted", abort);
      reply.raw.once("close", abort);

      const send = (): Promise<Dispatcher.ResponseData> => undiciRequest(this.upstreamUrl(request, path), {
        method: request.method as Dispatcher.HttpMethod,
        headers: buildUpstreamHeaders(request.headers, credential, request.method === "GET" ? undefined : rawBody.byteLength),
        body: request.method === "GET" ? undefined : rawBody,
        signal: controller.signal,
        headersTimeout: 120_000,
        bodyTimeout: 0,
      });

      let upstream = await send();
      if (upstream.statusCode === 401) {
        await upstream.body.dump();
        credential = await this.options.auth.refresh(account.id);
        upstream = await send();
      }
      if (upstream.statusCode === 429) {
        this.options.database.accounts.update(account.id, { authStatus: "rate_limited" });
        void this.options.usage.refresh(account.id).catch(() => undefined);
      }

      copyResponseHeaders(responseHeaders(upstream.headers), reply.raw);
      reply.hijack();
      reply.raw.writeHead(upstream.statusCode);
      let bytesOut = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesOut += chunk.byteLength;
          callback(null, chunk);
        },
      });
      await pipeline(upstream.body, counter, reply.raw);
      this.options.database.requestLog.log({
        requestId: request.id,
        route: path,
        transport,
        accountId: account.id,
        statusCode: upstream.statusCode,
        durationMs: Date.now() - startedAt,
        bytesIn: rawBody.byteLength,
        bytesOut,
      });
    } catch (error) {
      const status = errorStatus(error);
      this.options.database.requestLog.log({
        requestId: request.id,
        route: path,
        transport,
        statusCode: status,
        durationMs: Date.now() - startedAt,
        bytesIn: rawBody.byteLength,
        errorCode: (error as Error).message,
      });
      if (!reply.raw.headersSent) await reply.code(status).send({ error: (error as Error).message });
      else reply.raw.destroy(error as Error);
    }
  }

  private upstreamUrl(request: FastifyRequest, path: "/responses" | "/responses/compact" | "/models"): string {
    const base = `${this.options.upstreamBaseUrl}${path}`;
    const rawUrl = request.raw.url ?? "";
    const queryIndex = rawUrl.indexOf("?");
    if (queryIndex === -1) return base;
    // Preserve the client's query string (e.g. ?client_version=...) so the
    // upstream receives the parameters Codex sends on the /models route.
    return `${base}${rawUrl.slice(queryIndex)}`;
  }

  private rawBody(body: unknown): Buffer {
    if (Buffer.isBuffer(body)) return body;
    if (body === undefined || body === null) return Buffer.alloc(0);
    throw new Error("raw_request_body_unavailable");
  }
}
