import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import WebSocket, { type RawData } from "ws";
import type { AccountRecord, IdentityMode } from "../types.js";
import { AccountAuthService } from "../accounts/account-auth-service.js";
import { GatewayDatabase } from "../db/database.js";
import { ActiveAccountService } from "../routing/active-account-service.js";
import { hasBrowserOrigin } from "../security/origin-guard.js";
import { clientPassthroughWebsocketHeaders, IMPORTANT_WS_RESPONSE_HEADERS, isCompactionRequest, websocketUpgradeHeaders } from "./headers.js";
import { inspectClientFrame, inspectServerFrame, rawDataBuffer } from "./ws-metadata.js";
import { WebSocketConnectionRegistry, type WebSocketConnectionHandle } from "./websocket-connection-registry.js";
import { classifyProtocolTerminal, clientCancellation, transportFailure } from "./request-classification.js";

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
  websocketConnections: WebSocketConnectionRegistry;
}

interface UpstreamConnection {
  socket: WebSocket;
  responseHeaders: Record<string, string>;
}

interface PreparedConnection {
  upstream: WebSocket;
  account: AccountRecord | null;
  identityMode: IdentityMode;
  startedAt: number;
  transport: "ws" | "compact";
  registryHandle: WebSocketConnectionHandle;
  connectionLogId: string;
}

interface PendingRequest {
  logId: string | null;
  requestId: string;
  startedAt: number;
  transport: "ws" | "compact";
  bytesIn: number;
  bytesOut: number;
  parseFailed: boolean;
}

interface ResponseLifecycle {
  request: PendingRequest | undefined;
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

function connectOnce(url: string, request: FastifyRequest, headers: Record<string, string | string[]>): Promise<UpstreamConnection> {
  return new Promise((resolve, reject) => {
    const protocolHeader = request.headers["sec-websocket-protocol"];
    const protocols = typeof protocolHeader === "string" ? protocolHeader.split(",").map((value) => value.trim()).filter(Boolean) : [];
    const socket = new WebSocket(url, protocols, {
      headers,
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
    return await connectOnce(upstreamWsUrl(options.upstreamBaseUrl), request, websocketUpgradeHeaders(request.headers, credential));
  } catch (error) {
    if (!(error instanceof WebSocketHandshakeError) || error.statusCode !== 401) throw error;
    credential = await options.auth.refresh(account.id);
    return connectOnce(upstreamWsUrl(options.upstreamBaseUrl), request, websocketUpgradeHeaders(request.headers, credential));
  }
}

export async function registerWebSocketProxy(app: FastifyInstance, options: WsProxyOptions): Promise<void> {
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD_BYTES, autoPong: false } });
  const unsubscribeAccountChanges = options.activeAccounts.onChange((previousAccountId, accountId) => {
    if (previousAccountId && previousAccountId !== accountId) options.websocketConnections.retireAccount(previousAccountId);
  });
  app.addHook("onClose", async () => unsubscribeAccountChanges());
  const prepared = new WeakMap<FastifyRequest, PreparedConnection>();
  const upgradeHeaders = new WeakMap<IncomingMessage, Record<string, string>>();
  app.websocketServer.on("headers", (headers, request) => {
    for (const [name, value] of Object.entries(upgradeHeaders.get(request) ?? {})) headers.push(`${name}: ${value}`);
  });

  app.get("/backend-api/codex/responses", {
    websocket: true,
    preValidation: async (request: FastifyRequest, reply: FastifyReply) => {
      if (hasBrowserOrigin(request)) {
        const connectionLogId = options.database.websocketConnectionLog.start({ connectionId: request.id, identityMode: "managed_account", startedAt: Date.now() });
        options.database.websocketConnectionLog.finish(connectionLogId, { handshakeHttpStatus: 403, closeInitiator: "gateway", closeReasonCode: "browser_origin_not_allowed", outcome: "rejected" });
        await reply.code(403).send({ error: "browser_origin_not_allowed" });
        return;
      }
      const startedAt = Date.now();
      const transport = isCompactionRequest(request.headers) ? "compact" : "ws";
      const identity = options.activeAccounts.resolveIdentity();
      if (identity.mode === "unavailable") {
        const connectionLogId = options.database.websocketConnectionLog.start({ connectionId: request.id, identityMode: "managed_account", startedAt });
        options.database.websocketConnectionLog.finish(connectionLogId, { handshakeHttpStatus: 503, closeInitiator: "gateway", closeReasonCode: "no_active_account_selected", outcome: "rejected" });
        await reply.code(503).send({ error: "no_active_account_selected" });
        return;
      }
      const account = identity.mode === "managed_account" ? identity.account : null;
      if (account?.fedRamp) {
        const connectionLogId = options.database.websocketConnectionLog.start({ connectionId: request.id, accountId: account.id, identityMode: identity.mode, startedAt });
        options.database.websocketConnectionLog.finish(connectionLogId, { handshakeHttpStatus: 409, closeInitiator: "gateway", closeReasonCode: "fedramp_accounts_not_supported", outcome: "rejected" });
        await reply.code(409).send({ error: "fedramp_accounts_not_supported" });
        return;
      }
      const registryHandle = options.websocketConnections.add({
        connectionId: request.id,
        accountId: account?.id,
        connectedAt: startedAt,
      });
      const connectionLogId = options.database.websocketConnectionLog.start({ connectionId: request.id, accountId: account?.id, identityMode: identity.mode, startedAt });
      try {
        const connection = account
          ? await connectWithAuthRetry(options, request, account)
          : await connectOnce(upstreamWsUrl(options.upstreamBaseUrl), request, clientPassthroughWebsocketHeaders(request.headers));
        upgradeHeaders.set(request.raw, connection.responseHeaders);
        for (const [name, value] of Object.entries(connection.responseHeaders)) reply.header(name, value);
        registryHandle.update("idle");
        options.database.websocketConnectionLog.setHandshake(connectionLogId, 101);
        prepared.set(request, { upstream: connection.socket, account, identityMode: identity.mode, startedAt, transport, registryHandle, connectionLogId });
      } catch (error) {
        registryHandle.remove();
        const status = error instanceof WebSocketHandshakeError ? error.statusCode : 502;
        const errorCode = error instanceof WebSocketHandshakeError ? error.message : "upstream_websocket_handshake_failed";
        options.database.websocketConnectionLog.finish(connectionLogId, { handshakeHttpStatus: status, closeInitiator: "upstream", closeReasonCode: errorCode, outcome: status < 500 ? "rejected" : "failed" });
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
    const responseLifecycles: ResponseLifecycle[] = [];
    let retiring = false;

    const finishPending = (initiator: "client" | "upstream", errorCode: string) => {
      for (const lifecycle of responseLifecycles.splice(0)) {
        if (lifecycle.request) options.database.requestLog.finishRequest(lifecycle.request.logId, {
          ...(initiator === "client" ? clientCancellation() : transportFailure(lifecycle.request.parseFailed ? "protocol_event_parse_failed" : errorCode)),
          bytesIn: lifecycle.request.bytesIn, bytesOut: lifecycle.request.bytesOut,
        });
      }
    };

    const closeOnce = (input: { initiator: "client" | "upstream" | "gateway"; code?: number; reason: string; failed?: boolean }) => {
      if (closed) return;
      closed = true;
      options.database.websocketConnectionLog.finish(context.connectionLogId, {
        ...(input.initiator === "client" ? { clientCloseCode: input.code } : input.initiator === "upstream" ? { upstreamCloseCode: input.code } : {}),
        closeInitiator: input.initiator, closeReasonCode: input.reason,
        outcome: retiring ? "retired" : input.failed ? "failed" : "closed",
      });
    };

    const closeRetiredConnection = () => {
      if (!retiring || responseLifecycles.length > 0 || closed) return;
      if (client.readyState === WebSocket.OPEN) client.close(1000, "account_changed");
      if (context.upstream.readyState === WebSocket.OPEN) context.upstream.close(1000, "account_changed");
    };

    context.registryHandle.setRetire(() => {
      retiring = true;
      closeRetiredConnection();
    });

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
      if (metadata?.type === "response.create" && responseLifecycles.length < MAX_PENDING_FRAMES) {
        const trackedRequest: PendingRequest | undefined = metadata.generate === false ? undefined : {
          logId: null,
          requestId: `${request.id}:${++requestSequence}`,
          startedAt: Date.now(),
          transport: metadata.requestKind === "compaction" ? "compact" as const : "ws" as const,
          bytesIn: rawDataBuffer(data).byteLength,
          bytesOut: 0,
          parseFailed: false,
        };
        if (trackedRequest) trackedRequest.logId = options.database.requestLog.startRequest({ requestId: trackedRequest.requestId, route: "/responses", transport: trackedRequest.transport, accountId: context.account?.id, identityMode: context.identityMode, startedAt: trackedRequest.startedAt, bytesIn: trackedRequest.bytesIn });
        responseLifecycles.push({ request: trackedRequest });
        context.registryHandle.update("transmitting", trackedRequest?.requestId);
      }
      forwardOrQueue(data, isBinary);
    });
    client.on("close", (code, reason) => {
      context.registryHandle.remove();
      if (context.upstream.readyState === WebSocket.OPEN || context.upstream.readyState === WebSocket.CONNECTING) {
        closePeer(context.upstream, code, reason);
      }
      finishPending("client", "client_cancelled");
      closeOnce({ initiator: retiring ? "gateway" : "client", code, reason: retiring ? "account_switch_connection_retired" : `client_close_${code}` });
    });
    client.on("error", () => {
      context.registryHandle.remove();
      context.upstream.terminate();
      finishPending("client", "client_websocket_error");
      closeOnce({ initiator: "client", reason: "client_websocket_error", failed: true });
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
      const lifecycle = responseLifecycles[0];
      if (lifecycle?.request) lifecycle.request.bytesOut += rawDataBuffer(data).byteLength;
      const metadata = lifecycle && inspectServerFrame(data, isBinary);
      if (metadata?.parseFailed && lifecycle?.request) lifecycle.request.parseFailed = true;
      const terminal = metadata && !metadata.parseFailed ? classifyProtocolTerminal(metadata.type ?? "", metadata.errorCode ?? metadata.incompleteReason, metadata.status) : null;
      if (terminal && lifecycle) {
        responseLifecycles.shift();
        if (lifecycle.request) options.database.requestLog.finishRequest(lifecycle.request.logId, { ...terminal, bytesIn: lifecycle.request.bytesIn, bytesOut: lifecycle.request.bytesOut });
        const activeRequestId = responseLifecycles.find((item) => item.request)?.request?.requestId;
        context.registryHandle.update(responseLifecycles.length > 0 ? "transmitting" : "idle", activeRequestId);
      }
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary }, terminal && retiring ? closeRetiredConnection : undefined);
      }
    });
    context.upstream.on("close", (code, reason) => {
      context.registryHandle.remove();
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) closePeer(client, code, reason);
      finishPending("upstream", "upstream_connection_closed");
      closeOnce({ initiator: retiring ? "gateway" : "upstream", code, reason: retiring ? "account_switch_connection_retired" : `upstream_close_${code}`, failed: !retiring && code !== 1000 });
    });
    context.upstream.on("error", () => {
      context.registryHandle.remove();
      if (client.readyState === WebSocket.OPEN) client.close(1011, "upstream_error");
      finishPending("upstream", "upstream_websocket_error");
      closeOnce({ initiator: "upstream", reason: "upstream_websocket_error", failed: true });
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
