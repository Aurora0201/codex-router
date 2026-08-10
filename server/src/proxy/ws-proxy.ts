import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { type RawData } from "ws";
import type { AccountRecord, CredentialSnapshot } from "../types.js";
import { AccountAuthService } from "../accounts/account-auth-service.js";
import { GatewayDatabase } from "../db/database.js";
import { ActiveAccountService } from "../routing/active-account-service.js";
import { hasBrowserOrigin } from "../security/origin-guard.js";
import { IMPORTANT_WS_RESPONSE_HEADERS, isCompactionRequest, websocketUpgradeHeaders } from "./headers.js";
import { inspectClientFrame, inspectServerFrame, rawDataBuffer, websocketTerminalOutcome } from "./ws-metadata.js";

const MAX_PENDING_FRAMES = 32;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;
// Single-frame cap on the client->gateway WebSocket. Kept in line with the ws
// client default used for the upstream leg: Codex serializes the whole request
// (including images) into one frame, and a proxy must not impose a smaller
// limit than the upstream it forwards to.
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

interface WsProxyOptions {
  upstreamBaseUrl: string;
  activeAccounts: ActiveAccountService;
  auth: AccountAuthService;
  database: GatewayDatabase;
}

interface UpstreamConnection {
  socket: WebSocket;
  responseHeaders: Record<string, string>;
}

interface PreparedConnection {
  upstream: WebSocket;
  account: AccountRecord;
  startedAt: number;
  transport: "ws" | "compact";
}

interface PendingRequest {
  requestId: string;
  startedAt: number;
  transport: "ws" | "compact";
  bytesIn: number;
  bytesOut: number;
}

class WebSocketHandshakeError extends Error {
  constructor(readonly statusCode: number) {
    super(`upstream_websocket_handshake_${statusCode}`);
  }
}

function upstreamWsUrl(baseUrl: string): string {
  const url = new URL(`${baseUrl}/responses`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function captureResponseHeaders(response: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of IMPORTANT_WS_RESPONSE_HEADERS) {
    const value = response.headers[name];
    if (typeof value === "string") result[name] = value;
    else if (Array.isArray(value)) result[name] = value.join(", ");
  }
  return result;
}

function connectOnce(url: string, request: FastifyRequest, credential: CredentialSnapshot): Promise<UpstreamConnection> {
  return new Promise((resolve, reject) => {
    const protocolHeader = request.headers["sec-websocket-protocol"];
    const protocols = typeof protocolHeader === "string" ? protocolHeader.split(",").map((value) => value.trim()).filter(Boolean) : [];
    const socket = new WebSocket(url, protocols, {
      headers: websocketUpgradeHeaders(request.headers, credential),
      followRedirects: false,
      handshakeTimeout: 120_000,
      perMessageDeflate: false,
      autoPong: false,
    });
    let responseHeaders: Record<string, string> = {};
    socket.once("upgrade", (response) => {
      responseHeaders = captureResponseHeaders(response);
    });
    socket.once("open", () => resolve({ socket, responseHeaders }));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      response.once("end", () => reject(new WebSocketHandshakeError(response.statusCode ?? 502)));
    });
    socket.once("error", reject);
  });
}

async function connectWithAuthRetry(
  options: WsProxyOptions,
  request: FastifyRequest,
  account: AccountRecord,
): Promise<UpstreamConnection> {
  let credential = await options.auth.getCredential(account.id);
  try {
    return await connectOnce(upstreamWsUrl(options.upstreamBaseUrl), request, credential);
  } catch (error) {
    if (!(error instanceof WebSocketHandshakeError) || error.statusCode !== 401) throw error;
    credential = await options.auth.refresh(account.id);
    return connectOnce(upstreamWsUrl(options.upstreamBaseUrl), request, credential);
  }
}

export async function registerWebSocketProxy(app: FastifyInstance, options: WsProxyOptions): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES, autoPong: false } });
  const prepared = new WeakMap<FastifyRequest, PreparedConnection>();
  const upgradeHeaders = new WeakMap<IncomingMessage, Record<string, string>>();
  app.websocketServer.on("headers", (headers, request) => {
    for (const [name, value] of Object.entries(upgradeHeaders.get(request) ?? {})) headers.push(`${name}: ${value}`);
  });

  app.get("/backend-api/codex/responses", {
    websocket: true,
    preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
      if (hasBrowserOrigin(request)) {
        await reply.code(403).send({ error: "browser_origin_not_allowed" });
        return;
      }
      const startedAt = Date.now();
      const transport = isCompactionRequest(request.headers) ? "compact" : "ws";
      const account = options.activeAccounts.get();
      if (!account) {
        options.database.requestLog.log({
          requestId: request.id,
          route: "/responses",
          transport,
          statusCode: 503,
          durationMs: Date.now() - startedAt,
          errorCode: "no_active_account_selected",
          outcome: "gateway_error",
          scope: "connection",
        });
        await reply.code(503).send({ error: "no_active_account_selected" });
        return;
      }
      if (account.fedRamp) {
        options.database.requestLog.log({
          requestId: request.id,
          route: "/responses",
          transport,
          statusCode: 409,
          durationMs: Date.now() - startedAt,
          errorCode: "fedramp_accounts_not_supported",
          outcome: "gateway_error",
          scope: "connection",
        });
        await reply.code(409).send({ error: "fedramp_accounts_not_supported" });
        return;
      }
      try {
        const connection = await connectWithAuthRetry(options, request, account);
        upgradeHeaders.set(request.raw, connection.responseHeaders);
        for (const [name, value] of Object.entries(connection.responseHeaders)) reply.header(name, value);
        prepared.set(request, { upstream: connection.socket, account, startedAt, transport });
      } catch (error) {
        const status = error instanceof WebSocketHandshakeError ? error.statusCode : 502;
        const errorCode = error instanceof WebSocketHandshakeError ? error.message : "upstream_websocket_handshake_failed";
        options.database.requestLog.log({
          requestId: request.id,
          route: "/responses",
          transport,
          accountId: account.id,
          statusCode: status,
          durationMs: Date.now() - startedAt,
          errorCode,
          outcome: "upstream_error",
          scope: "connection",
        });
        await reply.code(status).send({ error: errorCode });
      }
    },
  }, (client, request) => {
    const context = prepared.get(request);
    if (!context) {
      client.close(1011, "upstream_not_ready");
      return;
    }
    prepared.delete(request);
    upgradeHeaders.delete(request.raw);

    const pending: { data: RawData; isBinary: boolean; size: number }[] = [];
    let pendingBytes = 0;
    let closed = false;
    let requestSequence = 0;
    const pendingRequests: PendingRequest[] = [];

    const finishRequest = (pendingRequest: PendingRequest, outcome: "success" | "rejected" | "upstream_error" | "client_cancelled", errorCode?: string) => {
      options.database.requestLog.log({
        requestId: pendingRequest.requestId,
        route: "/responses",
        transport: pendingRequest.transport,
        accountId: context.account.id,
        statusCode: outcome === "success" ? 200 : undefined,
        durationMs: Date.now() - pendingRequest.startedAt,
        bytesIn: pendingRequest.bytesIn,
        bytesOut: pendingRequest.bytesOut,
        errorCode,
        outcome,
        scope: "request",
      });
    };

    const finishPending = (outcome: "upstream_error" | "client_cancelled", errorCode: string) => {
      for (const pendingRequest of pendingRequests.splice(0)) finishRequest(pendingRequest, outcome, errorCode);
    };

    const closeOnce = (statusCode: number, errorCode?: string) => {
      if (closed) return;
      closed = true;
      options.database.requestLog.log({
        requestId: request.id,
        route: "/responses",
        transport: context.transport,
        accountId: context.account.id,
        statusCode,
        durationMs: Date.now() - context.startedAt,
        errorCode,
        outcome: errorCode?.startsWith("upstream_") ? "upstream_error" : errorCode === "client_websocket_error" ? "client_cancelled" : "success",
        scope: "connection",
      });
    };

    const forwardOrQueue = (data: RawData, isBinary: boolean) => {
      if (context.upstream.readyState === WebSocket.OPEN) {
        context.upstream.send(data, { binary: isBinary });
        return;
      }
      const size = Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(data.toString());
      if (pending.length >= MAX_PENDING_FRAMES || pendingBytes + size > MAX_PENDING_BYTES) {
        client.close(1013, "upstream_not_ready");
        return;
      }
      pending.push({ data, isBinary, size });
      pendingBytes += size;
    };

    // These handlers are deliberately installed synchronously before any await.
    client.on("message", (data, isBinary) => {
      const metadata = inspectClientFrame(data, isBinary);
      if (metadata?.type === "response.create" && metadata.generate !== false && pendingRequests.length < MAX_PENDING_FRAMES) {
        pendingRequests.push({
          requestId: `${request.id}:${++requestSequence}`,
          startedAt: Date.now(),
          transport: metadata.requestKind === "compaction" ? "compact" : "ws",
          bytesIn: rawDataBuffer(data).byteLength,
          bytesOut: 0,
        });
      }
      forwardOrQueue(data, isBinary);
    });
    client.on("close", (code, reason) => {
      if (context.upstream.readyState === WebSocket.OPEN || context.upstream.readyState === WebSocket.CONNECTING) {
        closePeer(context.upstream, code, reason);
      }
      finishPending("client_cancelled", "client_cancelled");
      closeOnce(101, `client_close_${code}`);
    });
    client.on("error", () => {
      context.upstream.terminate();
      finishPending("client_cancelled", "client_websocket_error");
      closeOnce(502, "client_websocket_error");
    });
    client.on("ping", (data) => {
      if (context.upstream.readyState === WebSocket.OPEN) context.upstream.ping(data);
    });
    client.on("pong", (data) => {
      if (context.upstream.readyState === WebSocket.OPEN) context.upstream.pong(data);
    });

    context.upstream.on("open", () => {
      for (const frame of pending.splice(0)) context.upstream.send(frame.data, { binary: frame.isBinary });
      pendingBytes = 0;
    });
    context.upstream.on("message", (data, isBinary) => {
      const pendingRequest = pendingRequests[0];
      if (pendingRequest) {
        pendingRequest.bytesOut += rawDataBuffer(data).byteLength;
        const metadata = inspectServerFrame(data, isBinary);
        const terminal = metadata && websocketTerminalOutcome(metadata);
        if (terminal) {
          pendingRequests.shift();
          finishRequest(pendingRequest, terminal.outcome, terminal.errorCode);
        }
      }
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    context.upstream.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) closePeer(client, code, reason);
      finishPending("upstream_error", "upstream_connection_closed");
      closeOnce(101, `upstream_close_${code}`);
    });
    context.upstream.on("error", () => {
      if (client.readyState === WebSocket.OPEN) client.close(1011, "upstream_error");
      finishPending("upstream_error", "upstream_websocket_error");
      closeOnce(502, "upstream_websocket_error");
    });
    context.upstream.on("ping", (data) => {
      if (client.readyState === WebSocket.OPEN) client.ping(data);
    });
    context.upstream.on("pong", (data) => {
      if (client.readyState === WebSocket.OPEN) client.pong(data);
    });

    if (context.upstream.readyState === WebSocket.OPEN && pending.length > 0) {
      for (const frame of pending.splice(0)) context.upstream.send(frame.data, { binary: frame.isBinary });
    }
  });
}

function closePeer(socket: WebSocket, code: number, reason: Buffer): void {
  const valid = code === 1000 || (code >= 3000 && code <= 4999) || (code >= 1001 && code <= 1014 && ![1004, 1005, 1006].includes(code));
  if (!valid) {
    socket.terminate();
    return;
  }
  socket.close(code, reason.subarray(0, 123));
}
