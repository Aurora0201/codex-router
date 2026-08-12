import { once } from "node:events";
import { execFile } from "node:child_process";
import http, { type IncomingHttpHeaders } from "node:http";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { buildGateway, type GatewayApp } from "../src/app.js";
import { openDirectory } from "../src/system/directory-opener.js";

vi.mock("../src/system/directory-opener.js", () => ({
  openDirectory: vi.fn(async () => undefined),
}));

interface ReceivedRequest {
  url: string;
  body: Buffer;
  headers: IncomingHttpHeaders;
}

let root: string;
let upstream: http.Server;
let upstreamUrl: string;
let gateway: GatewayApp;
let gatewayUrl: string;
let emptyGatewayRoot: string;
let emptyGateway: GatewayApp;
let emptyGatewayUrl: string;
let wsServer: WebSocketServer;
let webDir: string;
const received: ReceivedRequest[] = [];
const wsAccounts: string[] = [];
const execFileAsync = promisify(execFile);
let abortedSlowRequest = false;
let unauthorizedAttempts = 0;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    ),
  );
}

function collect(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function streamRequest(
  url: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  chunks: Buffer[];
  firstAt: number;
  endedAt: number;
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let firstAt = 0;
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(body.byteLength),
          ...headers,
        },
      },
      (response) => {
        response.on("data", (chunk) => {
          if (!firstAt) firstAt = Date.now();
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            chunks,
            firstAt,
            endedAt: Date.now(),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

beforeAll(async () => {
  process.env.GATEWAY_LOG_LEVEL = "silent";
  root = await mkdtemp(path.join(os.tmpdir(), "codex-router-e2e-"));
  webDir = path.join(root, "web");
  await mkdir(webDir, { recursive: true });
  await writeFile(path.join(webDir, "index.html"), "<h1>admin-web</h1>");
  wsServer = new WebSocketServer({ noServer: true });
  wsServer.on("headers", (headers) =>
    headers.push(
      "x-models-etag: mock-etag",
      "x-reasoning-included: true",
      "openai-model: mock-codex",
    ),
  );
  wsServer.on("connection", (socket, request) => {
    wsAccounts.push(String(request.headers["chatgpt-account-id"]));
    socket.on("message", (data, isBinary) => {
      if (data.toString() === "close-me") socket.close(4001, "mock_complete");
      else {
        socket.send(data, { binary: isBinary });
        try {
          const metadata = JSON.parse(data.toString()) as {
            type?: string;
            generate?: boolean;
            delayComplete?: boolean;
            failCode?: string;
            topError?: boolean;
            incomplete?: boolean;
          };
          if (metadata.type === "response.create") {
            const terminal = metadata.topError
              ? '{"type":"error","status":429,"error":{"code":"usage_limit_reached"}}'
              : metadata.incomplete
                ? '{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}'
                : metadata.failCode
                  ? JSON.stringify({
                      type: "response.failed",
                      response: { error: { code: metadata.failCode } },
                    })
                  : '{"type":"response.completed","response":{"status":"completed"}}';
            setTimeout(
              () => socket.send(terminal),
              metadata.delayComplete ? 80 : 10,
            );
          }
        } catch {
          // Opaque non-JSON frames are echoed unchanged.
        }
      }
    });
  });

  upstream = http.createServer(async (request, response) => {
    const body = await collect(request);
    received.push({ url: request.url ?? "", body, headers: request.headers });
    if (
      request.url === "/backend-api/codex/models" ||
      request.url?.startsWith("/backend-api/codex/models?")
    ) {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-models-etag": "models-1",
      });
      response.end('{"data":[{"id":"mock-codex"}]}');
      return;
    }
    if (body.includes(Buffer.from('"passthrough401":true'))) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"expired"}');
      return;
    }
    if (
      body.includes(Buffer.from('"cause401":true')) &&
      unauthorizedAttempts++ === 0
    ) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"expired"}');
      return;
    }
    if (body.includes(Buffer.from('"partialAuthError":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"type":"error","status":401,"error":{"code":"unauthorized_after_stream"}}\n\n',
      );
      return;
    }
    if (body.includes(Buffer.from('"sseIncomplete":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      );
      return;
    }
    if (body.includes(Buffer.from('"sseFailed":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        'data: {"type":"response.failed","response":{"error":{"code":"future_private_code"}}}\n\n',
      );
      return;
    }
    if (body.includes(Buffer.from('"rate429":true'))) {
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
      });
      response.end('{"error":"rate_limited"}');
      return;
    }
    if (body.includes(Buffer.from('"slow":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      response.on("close", () => {
        abortedSlowRequest = true;
      });
      const timer = setInterval(() => response.write("data: waiting\n\n"), 30);
      response.on("close", () => clearInterval(timer));
      return;
    }
    if (request.url === "/backend-api/codex/responses/compact") {
      if (body.includes(Buffer.from('"compactError":true'))) {
        response.writeHead(422, {
          "content-type": "application/json",
          "x-upstream-error": "compact",
        });
        response.end('{"error":"compact_invalid"}');
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": "compact-1",
      });
      response.end(body);
      return;
    }
    if (request.url === "/backend-api/codex/alpha/search") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-id": "search-1",
      });
      response.end(body);
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "x-request-id": "stream-1",
    });
    response.write("data: first\n\n");
    setTimeout(
      () =>
        response.end(
          'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        ),
      60,
    );
  });
  upstream.on("upgrade", (request, socket, head) => {
    if (request.url !== "/backend-api/codex/responses") {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (websocket) =>
      wsServer.emit("connection", websocket, request),
    );
  });
  const upstreamPort = await listen(upstream);
  upstreamUrl = `http://127.0.0.1:${upstreamPort}/backend-api/codex`;

  gateway = await buildGateway({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: upstreamUrl,
    developerMode: true,
    dataDir: path.join(root, "data"),
    accountsDir: path.join(root, "data", "accounts"),
    databasePath: path.join(root, "data", "gateway.db"),
    webDistDir: webDir,
  });
  const accountHome = path.join(
    root,
    "data",
    "accounts",
    "local",
    "codex-home",
  );
  await mkdir(accountHome, { recursive: true });
  await writeFile(
    path.join(accountHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: "top-secret",
        account_id: "upstream-account",
        refresh_token: "never-log",
      },
    }),
  );
  gateway.database.accounts.insert({ id: "local", codexHome: accountHome });
  gateway.database.accounts.update("local", {
    authStatus: "ready",
    email: "test@example.test",
    planType: "plus",
    chatgptAccountId: "upstream-account",
  });
  const secondHome = path.join(
    root,
    "data",
    "accounts",
    "second",
    "codex-home",
  );
  await mkdir(secondHome, { recursive: true });
  await writeFile(
    path.join(secondHome, "auth.json"),
    JSON.stringify({
      tokens: {
        access_token: "second-secret",
        account_id: "upstream-account-2",
        refresh_token: "never-log-2",
      },
    }),
  );
  gateway.database.accounts.insert({ id: "second", codexHome: secondHome });
  gateway.database.accounts.update("second", {
    authStatus: "ready",
    email: "second@example.test",
    planType: "plus",
    chatgptAccountId: "upstream-account-2",
  });
  gateway.activeAccounts.select("local");
  gatewayUrl = await gateway.app.listen({ host: "127.0.0.1", port: 0 });

  emptyGatewayRoot = path.join(root, "empty-gateway");
  emptyGateway = await buildGateway({
    host: "127.0.0.1",
    port: 0,
    upstreamBaseUrl: upstreamUrl,
    developerMode: true,
    dataDir: emptyGatewayRoot,
    accountsDir: path.join(emptyGatewayRoot, "accounts"),
    databasePath: path.join(emptyGatewayRoot, "gateway.db"),
    webDistDir: webDir,
  });
  emptyGatewayUrl = await emptyGateway.app.listen({
    host: "127.0.0.1",
    port: 0,
  });
});

afterAll(async () => {
  await gateway.app.close();
  await emptyGateway.app.close();
  wsServer.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  delete process.env.GATEWAY_LOG_LEVEL;
});

describe("empty account pool passthrough", () => {
  const clientHeaders = {
    authorization: "Bearer client-secret",
    "chatgpt-account-id": "client-account",
    "x-codex-feature": "passthrough",
    cookie: "must-not-forward=true",
  };

  it("passes HTTP routes through with the Codex client identity and records the identity mode", async () => {
    const raw = Buffer.from('{"opaque":"unchanged"}');
    for (const route of ["responses", "responses/compact", "alpha/search"]) {
      const result = await streamRequest(
        `${emptyGatewayUrl}/backend-api/codex/${route}`,
        raw,
        clientHeaders,
      );
      expect(result.status).toBe(200);
      const request = received.findLast((entry) =>
        entry.url.endsWith(`/${route}`),
      )!;
      expect(request.body.equals(raw)).toBe(true);
      expect(request.headers.authorization).toBe("Bearer client-secret");
      expect(request.headers["chatgpt-account-id"]).toBe("client-account");
      expect(request.headers["x-codex-feature"]).toBe("passthrough");
      expect(request.headers.cookie).toBeUndefined();
    }
    const models = await fetch(
      `${emptyGatewayUrl}/backend-api/codex/models?client_version=0.147.0`,
      { headers: clientHeaders },
    );
    expect(models.status).toBe(200);
    const modelsRequest = received.findLast((entry) =>
      entry.url.endsWith("/models?client_version=0.147.0"),
    )!;
    expect(modelsRequest.headers.authorization).toBe("Bearer client-secret");
    expect(modelsRequest.headers["chatgpt-account-id"]).toBe("client-account");

    const logs = emptyGateway.database.requestLog.query({
      since: 0,
      accountId: "__client_passthrough__",
      limit: 100,
    });
    expect(logs.items).toHaveLength(4);
    expect(
      logs.items.every(
        (entry) =>
          entry.identityMode === "client_passthrough" &&
          entry.accountId === undefined,
      ),
    ).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("client-secret");
  });

  it("does not refresh or mutate managed accounts for passthrough 401 and 429 responses", async () => {
    const before401 = received.length;
    const unauthorized = await streamRequest(
      `${emptyGatewayUrl}/backend-api/codex/responses`,
      Buffer.from('{"passthrough401":true}'),
      clientHeaders,
    );
    expect(unauthorized.status).toBe(401);
    expect(received.length - before401).toBe(1);

    const limited = await streamRequest(
      `${emptyGatewayUrl}/backend-api/codex/responses`,
      Buffer.from('{"rate429":true}'),
      clientHeaders,
    );
    expect(limited.status).toBe(429);
    expect(emptyGateway.database.accounts.list()).toEqual([]);
  });

  it("passes WebSocket authentication and frames through without registering a managed account", async () => {
    const socket = new WebSocket(
      emptyGatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
      {
        headers: clientHeaders,
      },
    );
    await once(socket, "open");
    const frame = '{"type":"response.create","opaque":"client-frame"}';
    socket.send(frame);
    expect((await once(socket, "message"))[0].toString()).toBe(frame);
    await once(socket, "message");
    expect(wsAccounts.at(-1)).toBe("client-account");
    socket.close(1000, "done");
    await once(socket, "close");

    const logs = emptyGateway.database.requestLog.query({
      since: 0,
      accountId: "__client_passthrough__",
      transport: "ws",
      limit: 100,
    });
    expect(
      logs.items.some(
        (entry) => entry.state === "completed" && entry.outcome === "success",
      ),
    ).toBe(true);
    expect(
      logs.items.every((entry) => entry.identityMode === "client_passthrough"),
    ).toBe(true);
  });
});

describe("HTTP, SSE, compact and models", () => {
  it("streams untouched request and response bytes with replaced auth", async () => {
    const raw = Buffer.from(
      '{ "client_metadata": { "thread_id": "http-thread" }, "input": [{"type":"future_tool_item","raw":true}] }',
    );
    const result = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      raw,
      {
        authorization: "Bearer client-secret",
        "chatgpt-account-id": "client-account",
        "x-codex-feature": "opaque",
      },
    );
    expect(result.status).toBe(200);
    expect(Buffer.concat(result.chunks).toString()).toBe(
      'data: first\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    );
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.endedAt - result.firstAt).toBeGreaterThanOrEqual(40);
    const request = received.findLast((entry) =>
      entry.url.endsWith("/responses"),
    )!;
    expect(request.body.equals(raw)).toBe(true);
    expect(request.headers.authorization).toBe("Bearer top-secret");
    expect(request.headers["chatgpt-account-id"]).toBe("upstream-account");
    expect(request.headers["x-codex-feature"]).toBe("opaque");
    expect(request.headers.cookie).toBeUndefined();
  });

  it("proxies compact and models on the currently selected active account", async () => {
    const compact = Buffer.from(
      '{"client_metadata":{"thread_id":"http-thread"},"opaque":"unchanged"}',
    );
    const compactResult = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses/compact`,
      compact,
    );
    expect(compactResult.status).toBe(200);
    expect(Buffer.concat(compactResult.chunks).equals(compact)).toBe(true);
    const models = await fetch(
      `${gatewayUrl}/backend-api/codex/models?client_version=0.147.0`,
    );
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ data: [{ id: "mock-codex" }] });
    expect(models.headers.get("x-models-etag")).toBe("models-1");
    expect(
      received.findLast((entry) =>
        entry.url.endsWith("/models?client_version=0.147.0"),
      ),
    ).toBeTruthy();
    expect(
      received.findLast((entry) => entry.url.endsWith("/responses/compact"))!
        .headers.authorization,
    ).toBe("Bearer top-secret");

    gateway.activeAccounts.select("second");
    const switched = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses/compact`,
      compact,
    );
    expect(switched.status).toBe(200);
    expect(
      received.findLast((entry) => entry.url.endsWith("/responses/compact"))!
        .headers.authorization,
    ).toBe("Bearer second-secret");
    gateway.activeAccounts.select("local");
  });

  it("classifies Responses compaction v2 from bounded Codex metadata without reading the body", async () => {
    const raw = Buffer.from('{"opaque":"compaction-v2-body"}');
    const result = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      raw,
      {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          compaction: { implementation: "responses_compaction_v2" },
        }),
      },
    );
    expect(result.status).toBe(200);
    expect(
      received
        .findLast((entry) => entry.url.endsWith("/responses"))!
        .body.equals(raw),
    ).toBe(true);
    const logs = gateway.database.requestLog.query({
      since: 0,
      transport: "compact",
      limit: 100,
    });
    expect(logs.items.some((entry) => entry.route === "/responses")).toBe(true);
  });
  it("proxies the standalone web-search endpoint opaquely on the active account", async () => {
    const raw = Buffer.from(
      '{"id":"search-session","model":"mock-codex","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"find this"}]}],"commands":{"search_query":[{"q":"OpenAI news"}]},"settings":{"external_web_access":true}}',
    );
    const result = await streamRequest(
      `${gatewayUrl}/backend-api/codex/alpha/search`,
      raw,
      {
        authorization: "Bearer client-secret",
        "chatgpt-account-id": "client-account",
        "x-codex-turn-metadata": "turn-1",
        originator: "chatgpt_cca",
      },
    );
    expect(result.status).toBe(200);
    expect(Buffer.concat(result.chunks).equals(raw)).toBe(true);
    expect(result.headers["x-request-id"]).toBe("search-1");
    const request = received.findLast((entry) =>
      entry.url.endsWith("/alpha/search"),
    )!;
    expect(request.body.equals(raw)).toBe(true);
    expect(request.headers.authorization).toBe("Bearer top-secret");
    expect(request.headers["chatgpt-account-id"]).toBe("upstream-account");
    expect(request.headers["x-codex-turn-metadata"]).toBe("turn-1");
    expect(request.headers.originator).toBe("chatgpt_cca");
    expect(request.headers.cookie).toBeUndefined();

    gateway.activeAccounts.select("second");
    const switched = await streamRequest(
      `${gatewayUrl}/backend-api/codex/alpha/search`,
      raw,
    );
    expect(switched.status).toBe(200);
    expect(
      received.findLast((entry) => entry.url.endsWith("/alpha/search"))!.headers
        .authorization,
    ).toBe("Bearer second-secret");
    gateway.activeAccounts.select("local");
  });

  it("refreshes the same account once on a pre-stream 401", async () => {
    const refresh = vi
      .spyOn(gateway.auth, "refresh")
      .mockImplementation((id) => gateway.auth.getCredential(id));
    const result = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      Buffer.from(
        '{"cause401":true,"client_metadata":{"thread_id":"retry-thread"}}',
      ),
    );
    expect(result.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      received.filter((entry) =>
        entry.body.includes(Buffer.from('"cause401":true')),
      ),
    ).toHaveLength(2);
    refresh.mockRestore();
  });

  it("does not replay after stream start and transparently returns 429/compact errors", async () => {
    const refresh = vi
      .spyOn(gateway.auth, "refresh")
      .mockImplementation((id) => gateway.auth.getCredential(id));
    const partial = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      Buffer.from(
        '{"partialAuthError":true,"client_metadata":{"thread_id":"partial-thread"}}',
      ),
    );
    expect(partial.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    const protocolFailure = gateway.database.requestLog.query({
      since: 0,
      query: "unauthorized_after_stream",
      limit: 100,
    }).items[0];
    expect(protocolFailure).toMatchObject({
      state: "rejected",
      outcome: "rejected",
      failureSource: "upstream_protocol",
      failureStage: "terminal",
      httpStatus: 401,
      protocolErrorCode: "unauthorized_after_stream",
    });
    const limited = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      Buffer.from(
        '{"rate429":true,"client_metadata":{"thread_id":"rate-thread"}}',
      ),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("30");
    const compact = await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses/compact`,
      Buffer.from(
        '{"compactError":true,"client_metadata":{"thread_id":"partial-thread"}}',
      ),
    );
    expect(compact.status).toBe(422);
    expect(compact.headers["x-upstream-error"]).toBe("compact");
    expect(Buffer.concat(compact.chunks).toString()).toBe(
      '{"error":"compact_invalid"}',
    );
    refresh.mockRestore();
    gateway.database.accounts.update("local", { authStatus: "ready" });
  });

  it("uses Responses SSE protocol terminals instead of the 200 envelope", async () => {
    await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      Buffer.from('{"sseIncomplete":true}'),
    );
    await streamRequest(
      `${gatewayUrl}/backend-api/codex/responses`,
      Buffer.from('{"sseFailed":true}'),
    );
    const logs = gateway.database.requestLog.query({
      since: 0,
      transport: "http",
      limit: 100,
    }).items;
    expect(
      logs.find((item) => item.protocolErrorCode === "max_output_tokens"),
    ).toMatchObject({
      state: "rejected",
      outcome: "rejected",
      httpStatus: undefined,
    });
    expect(
      logs.find((item) => item.protocolErrorCode === "future_private_code"),
    ).toMatchObject({ state: "failed", outcome: "upstream_error" });
  });

  it("carries an opaque multi-turn shell and file tool loop", async () => {
    const fixture = path.join(root, "tool-fixture.txt");
    await writeFile(fixture, "before");
    const first = Buffer.from(
      '{"client_metadata":{"thread_id":"tool-thread"},"tools":[{"type":"function","name":"shell"},{"type":"function","name":"write_file"}],"input":"inspect"}',
    );
    await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, first);
    const shell = await execFileAsync(process.execPath, [
      "-e",
      "process.stdout.write('shell-ok')",
    ]);
    await writeFile(fixture, "after");
    const second = Buffer.from(
      JSON.stringify({
        client_metadata: { thread_id: "tool-thread" },
        input: [
          {
            type: "function_call_output",
            call_id: "shell-1",
            output: shell.stdout,
          },
          { type: "function_call_output", call_id: "file-1", output: "after" },
          { type: "reasoning", opaque: { future: true } },
        ],
      }),
    );
    await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, second);
    const toolRequests = received.filter((entry) =>
      entry.body.includes(Buffer.from('"thread_id":"tool-thread"')),
    );
    expect(toolRequests.at(-2)!.body.equals(first)).toBe(true);
    expect(toolRequests.at(-1)!.body.equals(second)).toBe(true);
    expect(toolRequests.at(-1)!.body.toString()).toContain("shell-ok");
  });

  it("aborts the upstream when the downstream disconnects", async () => {
    await new Promise<void>((resolve, reject) => {
      const body = Buffer.from(
        '{"slow":true,"client_metadata":{"thread_id":"cancel-thread"}}',
      );
      const request = http.request(
        `${gatewayUrl}/backend-api/codex/responses`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(body.length),
          },
        },
        (response) => {
          response.once("data", () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.on("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ECONNRESET")
          reject(error);
      });
      request.end(body);
    });
    await vi.waitFor(
      () => {
        expect(abortedSlowRequest).toBe(true);
        const cancelled = gateway.database.requestLog.query({
          since: 0,
          status: "cancelled",
          transport: "http",
          limit: 100,
        });
        expect(
          cancelled.items.some(
            (entry) =>
              entry.errorCode === "client_cancelled" &&
              entry.statusCode === undefined,
          ),
        ).toBe(true);
      },
      { timeout: 2_000, interval: 20 },
    );
  });
});

describe("WebSocket transport", () => {
  it("classifies protocol failures and excludes prewarm from requests", async () => {
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(socket, "open");
    const before = gateway.database.requestLog.query({
      since: 0,
      transport: "ws",
      limit: 100,
    }).pagination.totalItems;
    for (const frame of [
      '{"type":"response.create","generate":false}',
      '{"type":"response.create","incomplete":true}',
      '{"type":"response.create","failCode":"future_private_code"}',
      '{"type":"response.create","topError":true}',
    ]) {
      socket.send(frame);
      await once(socket, "message");
      await once(socket, "message");
    }
    const result = gateway.database.requestLog.query({
      since: 0,
      transport: "ws",
      limit: 100,
    });
    expect(result.pagination.totalItems - before).toBe(3);
    expect(
      result.items.slice(0, 3).map((item) => item.protocolErrorCode),
    ).toEqual(
      expect.arrayContaining([
        "max_output_tokens",
        "future_private_code",
        "usage_limit_reached",
      ]),
    );
    socket.close(1000, "done");
    await once(socket, "close");
  });
  it("exposes only live connection metadata through the admin API", async () => {
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(socket, "open");

    const idle = (await fetch(`${gatewayUrl}/api/websocket-connections`).then(
      (response) => response.json(),
    )) as Array<{
      connectionId: string;
      state: string;
      connectedAt: number;
      activeRequestId?: string;
    }>;
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({
      state: "idle",
      connectedAt: expect.any(Number),
    });
    expect(Object.keys(idle[0]).sort()).toEqual([
      "connectedAt",
      "connectionId",
      "state",
    ]);

    socket.send('{"type":"response.create","delayComplete":true}');
    await once(socket, "message");
    const transmitting = (await fetch(
      `${gatewayUrl}/api/websocket-connections`,
    ).then((response) => response.json())) as typeof idle;
    expect(transmitting[0]).toMatchObject({
      connectionId: idle[0].connectionId,
      state: "transmitting",
      activeRequestId: `${idle[0].connectionId}:1`,
    });

    await once(socket, "message");
    await vi.waitFor(async () => {
      const connections = (await fetch(
        `${gatewayUrl}/api/websocket-connections`,
      ).then((response) => response.json())) as typeof idle;
      expect(connections[0]).toMatchObject({
        connectionId: idle[0].connectionId,
        state: "idle",
      });
    });
    socket.close(1000, "done");
    await once(socket, "close");
    await vi.waitFor(async () => {
      await expect(
        fetch(`${gatewayUrl}/api/websocket-connections`).then((response) =>
          response.json(),
        ),
      ).resolves.toEqual([]);
    });
  });

  it("preserves upgrade metadata, immediate frames, ping/pong and close reason", async () => {
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
      { headers: { "thread-id": "ws-thread" } },
    );
    let upgradeHeaders: IncomingHttpHeaders = {};
    socket.on("upgrade", (response) => {
      upgradeHeaders = response.headers;
    });
    await once(socket, "open");
    const frame =
      '{"type":"response.create","client_metadata":{"thread_id":"ws-thread"},"future_item":{"x":1}}';
    socket.send(frame);
    const [echo] = await once(socket, "message");
    expect(echo.toString()).toBe(frame);
    await once(socket, "message");
    expect(upgradeHeaders["x-models-etag"]).toBe("mock-etag");
    expect(upgradeHeaders["x-reasoning-included"]).toBe("true");
    expect(upgradeHeaders["openai-model"]).toBe("mock-codex");
    const compactFrame = JSON.stringify({
      type: "response.create",
      input: [{ type: "compaction_trigger" }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          compaction: { trigger: "manual" },
        }),
      },
    });
    socket.send(compactFrame);
    expect((await once(socket, "message"))[0].toString()).toBe(compactFrame);
    await once(socket, "message");
    const compactLogs = gateway.database.requestLog.query({
      since: 0,
      transport: "compact",
      limit: 100,
    });
    expect(
      compactLogs.items.some(
        (entry) =>
          entry.state === "completed" &&
          entry.outcome === "success" &&
          entry.bytesIn === Buffer.byteLength(compactFrame),
      ),
    ).toBe(true);
    const pong = once(socket, "pong");
    socket.ping("health");
    await pong;
    socket.send("close-me");
    const [code, reason] = await once(socket, "close");
    expect(code).toBe(4001);
    expect(reason.toString()).toBe("mock_complete");
    expect(wsAccounts.at(-1)).toBe("upstream-account");
    const reconnect = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
      { headers: { "thread-id": "ws-thread" } },
    );
    await once(reconnect, "open");
    reconnect.close(1000, "done");
    await once(reconnect, "close");
    expect(wsAccounts.slice(-2)).toEqual([
      "upstream-account",
      "upstream-account",
    ]);
  });

  it("retires an idle connection when the active account changes", async () => {
    gateway.activeAccounts.select("local");
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(socket, "open");

    gateway.activeAccounts.select("second");
    const [code, reason] = await once(socket, "close");
    expect(code).toBe(1000);
    expect(reason.toString()).toBe("account_changed");

    const reconnect = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(reconnect, "open");
    expect(wsAccounts.at(-1)).toBe("upstream-account-2");
    reconnect.close(1000, "done");
    await once(reconnect, "close");
    gateway.activeAccounts.select("local");
  });

  it("lets an in-flight response finish before retiring the old account connection", async () => {
    gateway.activeAccounts.select("local");
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(socket, "open");
    socket.send('{"type":"response.create","delayComplete":true}');
    await once(socket, "message");

    gateway.activeAccounts.select("second");
    const [terminal] = await once(socket, "message");
    expect(terminal.toString()).toContain('"response.completed"');
    const [code, reason] = await once(socket, "close");
    expect(code).toBe(1000);
    expect(reason.toString()).toBe("account_changed");

    const reconnect = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(reconnect, "open");
    expect(wsAccounts.at(-1)).toBe("upstream-account-2");
    reconnect.close(1000, "done");
    await once(reconnect, "close");
    gateway.activeAccounts.select("local");

    const retired = gateway.database.websocketConnectionLog.query({
      since: 0,
      outcome: "retired",
      limit: 100,
    });
    expect(
      retired.items.some(
        (entry) =>
          entry.closeReasonCode === "account_switch_connection_retired",
      ),
    ).toBe(true);
  });

  it("retires the active account connection when that account is disabled", async () => {
    gateway.activeAccounts.select("local");
    const socket = new WebSocket(
      gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses",
    );
    await once(socket, "open");

    gateway.accounts.setEnabled("local", false);
    const [code, reason] = await once(socket, "close");
    expect(code).toBe(1000);
    expect(reason.toString()).toBe("account_changed");

    gateway.accounts.setEnabled("local", true);
    gateway.activeAccounts.select("local");
  });
});

describe("security and admin API", () => {
  it("generates globally unique request IDs and ignores caller-provided IDs", async () => {
    const response = await fetch(`${gatewayUrl}/backend-api/codex/models`, {
      headers: { "request-id": "caller-controlled" },
    });
    expect(response.status).toBe(200);
    const item = gateway.database.requestLog.query({
      since: 0,
      transport: "models",
      limit: 100,
    }).items[0];
    expect(item?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(item?.requestId).not.toBe("caller-controlled");
  });

  it("serves the admin UI only from the canonical entrypoint", async () => {
    const redirect = await gateway.app.inject({ method: "GET", url: "/admin" });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("/admin/");
    expect(
      (await gateway.app.inject({ method: "GET", url: "/admin/" })).body,
    ).toContain("admin-web");

    for (const legacyUrl of ["/admin-v2", "/admin-v2/"]) {
      const legacy = await gateway.app.inject({
        method: "GET",
        url: legacyUrl,
      });
      expect(legacy.statusCode).toBe(404);
      expect(legacy.headers.location).toBeUndefined();
    }
  });

  it("returns a clear error when the canonical admin build is missing", async () => {
    const missing = path.join(root, "missing-dist");
    const withoutUi = await buildGateway({
      developerMode: true,
      upstreamBaseUrl: upstreamUrl,
      dataDir: path.join(root, "missing-ui-data"),
      databasePath: path.join(root, "missing-ui-data", "gateway.db"),
      webDistDir: missing,
    });
    expect(
      (await withoutUi.app.inject({ method: "GET", url: "/admin" })).statusCode,
    ).toBe(503);
    expect(
      (await withoutUi.app.inject({ method: "GET", url: "/admin-v2" }))
        .statusCode,
    ).toBe(404);
    await withoutUi.app.close();
  });

  it("fails closed for unknown data routes and browser origins", async () => {
    const unknown = await fetch(`${gatewayUrl}/backend-api/codex/anything`);
    expect(unknown.status).toBe(501);
    const browser = await fetch(`${gatewayUrl}/backend-api/codex/models`, {
      headers: { origin: "https://evil.test" },
    });
    expect(browser.status).toBe(403);
  });

  it("requires same-origin CSRF and never exposes credential paths", async () => {
    const health = await fetch(`${gatewayUrl}/api/health`);
    const data = (await health.json()) as { csrfToken: string };
    const cookie = health.headers.get("set-cookie")!.split(";")[0];
    const accountsResponse = (await (
      await fetch(`${gatewayUrl}/api/accounts`)
    ).json()) as {
      activeAccountId: string | null;
      accounts: Record<string, unknown>[];
    };
    expect(accountsResponse.activeAccountId).toBe("local");
    expect(accountsResponse.accounts[0]).not.toHaveProperty("codexHome");
    const rejected = await fetch(`${gatewayUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        origin: "https://evil.test",
        cookie,
        "x-csrf-token": data.csrfToken,
        "content-type": "application/json",
      },
      body: '{"theme":"dark"}',
    });
    expect(rejected.status).toBe(403);
    const accepted = await fetch(`${gatewayUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        origin: gatewayUrl,
        cookie,
        "x-csrf-token": data.csrfToken,
        "content-type": "application/json",
      },
      body: '{"theme":"dark"}',
    });
    expect(accepted.status).toBe(200);
    const proxiedOrigin = await fetch(`${gatewayUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        origin: "http://127.0.0.1:5173",
        cookie,
        "x-csrf-token": data.csrfToken,
        "content-type": "application/json",
      },
      body: '{"theme":"light"}',
    });
    expect(proxiedOrigin.status).toBe(200);
    const requestColumns = gateway.database.raw
      .prepare("PRAGMA table_info(request_log)")
      .all() as { name: string }[];
    expect(requestColumns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining([
        "prompt",
        "response",
        "tool_arguments",
        "tool_output",
        "authorization",
      ]),
    );
    expect(accepted.headers.get("access-control-allow-origin")).toBeNull();

    const opened = await fetch(`${gatewayUrl}/api/local-environment/open`, {
      method: "POST",
      headers: {
        origin: gatewayUrl,
        cookie,
        "x-csrf-token": data.csrfToken,
        "content-type": "application/json",
      },
      body: '{"target":"data"}',
    });
    expect(opened.status).toBe(204);
    expect(vi.mocked(openDirectory)).toHaveBeenCalledWith(
      gateway.config.dataDir,
    );
    const invalidTarget = await fetch(
      `${gatewayUrl}/api/local-environment/open`,
      {
        method: "POST",
        headers: {
          origin: gatewayUrl,
          cookie,
          "x-csrf-token": data.csrfToken,
          "content-type": "application/json",
        },
        body: '{"target":"arbitrary-path"}',
      },
    );
    expect(invalidTarget.status).toBe(400);
  });

  it("supports direct request-log pages and rejects page/cursor conflicts", async () => {
    const response = await gateway.app.inject({
      method: "GET",
      url: "/api/request-logs?range=24h&transport=http&page=1&limit=2",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: unknown[];
      pagination: {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
      };
    };
    expect(body.items.length).toBeLessThanOrEqual(2);
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 2 });
    expect(body.pagination.totalPages).toBe(
      Math.ceil(body.pagination.totalItems / 2),
    );
    expect(
      (
        await gateway.app.inject({
          method: "GET",
          url: "/api/request-logs?page=0",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await gateway.app.inject({
          method: "GET",
          url: "/api/request-logs?page=1&cursor=e30",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await gateway.app.inject({
          method: "GET",
          url: "/api/request-logs?from=200&to=100",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await gateway.app.inject({
          method: "GET",
          url: "/api/request-logs?state=unknown",
        })
      ).statusCode,
    ).toBe(400);
    const connections = await gateway.app.inject({
      method: "GET",
      url: "/api/websocket-connection-logs?page=1&limit=20",
    });
    expect(connections.statusCode).toBe(200);
    expect(connections.json()).toMatchObject({
      summary: {
        connections: expect.any(Number),
        failures: expect.any(Number),
        retired: expect.any(Number),
      },
      pagination: { page: 1, pageSize: 20 },
    });
    expect(
      (
        await gateway.app.inject({
          method: "GET",
          url: "/api/websocket-connection-logs?from=200&to=100",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("returns an explicit 503 for models when no account is enabled", async () => {
    gateway.accounts.setEnabled("local", false);
    const response = await fetch(`${gatewayUrl}/backend-api/codex/models`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "no_active_account_selected",
    });
    gateway.accounts.setEnabled("local", true);
    gateway.activeAccounts.select("local");
  });
});
