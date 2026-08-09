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

interface ReceivedRequest { url: string; body: Buffer; headers: IncomingHttpHeaders; }

let root: string;
let upstream: http.Server;
let upstreamUrl: string;
let gateway: GatewayApp;
let gatewayUrl: string;
let wsServer: WebSocketServer;
const received: ReceivedRequest[] = [];
const wsAccounts: string[] = [];
const execFileAsync = promisify(execFile);
let abortedSlowRequest = false;
let unauthorizedAttempts = 0;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

function collect(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function streamRequest(url: string, body: Buffer, headers: Record<string, string> = {}): Promise<{ status: number; headers: IncomingHttpHeaders; chunks: Buffer[]; firstAt: number; endedAt: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let firstAt = 0;
    const request = http.request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": String(body.byteLength), ...headers } }, (response) => {
      response.on("data", (chunk) => { if (!firstAt) firstAt = Date.now(); chunks.push(Buffer.from(chunk)); });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, chunks, firstAt, endedAt: Date.now() }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

beforeAll(async () => {
  process.env.GATEWAY_LOG_LEVEL = "silent";
  root = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-e2e-"));
  wsServer = new WebSocketServer({ noServer: true });
  wsServer.on("headers", (headers) => headers.push("x-models-etag: mock-etag", "x-reasoning-included: true", "openai-model: mock-codex"));
  wsServer.on("connection", (socket, request) => {
    wsAccounts.push(String(request.headers["chatgpt-account-id"]));
    socket.on("message", (data, isBinary) => {
      if (data.toString() === "close-me") socket.close(4001, "mock_complete");
      else socket.send(data, { binary: isBinary });
    });
  });

  upstream = http.createServer(async (request, response) => {
    const body = await collect(request);
    received.push({ url: request.url ?? "", body, headers: request.headers });
    if (request.url === "/backend-api/codex/models" || request.url?.startsWith("/backend-api/codex/models?")) {
      response.writeHead(200, { "content-type": "application/json", "x-models-etag": "models-1" });
      response.end('{"data":[{"id":"mock-codex"}]}');
      return;
    }
    if (body.includes(Buffer.from('"cause401":true')) && unauthorizedAttempts++ === 0) {
      response.writeHead(401, { "content-type": "application/json" }); response.end('{"error":"expired"}'); return;
    }
    if (body.includes(Buffer.from('"partialAuthError":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end('data: {"type":"error","code":"unauthorized_after_stream"}\n\n');
      return;
    }
    if (body.includes(Buffer.from('"rate429":true'))) {
      response.writeHead(429, { "content-type": "application/json", "retry-after": "30" });
      response.end('{"error":"rate_limited"}');
      return;
    }
    if (body.includes(Buffer.from('"slow":true'))) {
      response.writeHead(200, { "content-type": "text/event-stream" }); response.write("data: first\n\n");
      response.on("close", () => { abortedSlowRequest = true; });
      const timer = setInterval(() => response.write("data: waiting\n\n"), 30);
      response.on("close", () => clearInterval(timer));
      return;
    }
    if (request.url === "/backend-api/codex/responses/compact") {
      if (body.includes(Buffer.from('"compactError":true'))) {
        response.writeHead(422, { "content-type": "application/json", "x-upstream-error": "compact" });
        response.end('{"error":"compact_invalid"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "compact-1" });
      response.end(body);
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "stream-1" });
    response.write("data: first\n\n");
    setTimeout(() => response.end("data: second\n\n"), 60);
  });
  upstream.on("upgrade", (request, socket, head) => {
    if (request.url !== "/backend-api/codex/responses") { socket.destroy(); return; }
    wsServer.handleUpgrade(request, socket, head, (websocket) => wsServer.emit("connection", websocket, request));
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
    webDistDir: path.resolve("..", "web", "dist"),
  });
  const accountHome = path.join(root, "data", "accounts", "local", "codex-home");
  await mkdir(accountHome, { recursive: true });
  await writeFile(path.join(accountHome, "auth.json"), JSON.stringify({ tokens: { access_token: "top-secret", account_id: "upstream-account", refresh_token: "never-log" } }));
  gateway.database.accounts.insert({ id: "local", codexHome: accountHome });
  gateway.database.accounts.update("local", { authStatus: "ready", email: "test@example.test", planType: "plus", chatgptAccountId: "upstream-account" });
  const secondHome = path.join(root, "data", "accounts", "second", "codex-home");
  await mkdir(secondHome, { recursive: true });
  await writeFile(path.join(secondHome, "auth.json"), JSON.stringify({ tokens: { access_token: "second-secret", account_id: "upstream-account-2", refresh_token: "never-log-2" } }));
  gateway.database.accounts.insert({ id: "second", codexHome: secondHome });
  gateway.database.accounts.update("second", { authStatus: "ready", email: "second@example.test", planType: "plus", chatgptAccountId: "upstream-account-2" });
  gateway.activeAccounts.select("local");
  gatewayUrl = await gateway.app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  await gateway.app.close();
  wsServer.close();
  upstream.closeAllConnections();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  delete process.env.GATEWAY_LOG_LEVEL;
});

describe("HTTP, SSE, compact and models", () => {
  it("streams untouched request and response bytes with replaced auth", async () => {
    const raw = Buffer.from('{ "client_metadata": { "thread_id": "http-thread" }, "input": [{"type":"future_tool_item","raw":true}] }');
    const result = await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, raw, { authorization: "Bearer client-secret", "chatgpt-account-id": "client-account", "x-codex-feature": "opaque" });
    expect(result.status).toBe(200);
    expect(Buffer.concat(result.chunks).toString()).toBe("data: first\n\ndata: second\n\n");
    expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    expect(result.endedAt - result.firstAt).toBeGreaterThanOrEqual(40);
    const request = received.findLast((entry) => entry.url.endsWith("/responses"))!;
    expect(request.body.equals(raw)).toBe(true);
    expect(request.headers.authorization).toBe("Bearer top-secret");
    expect(request.headers["chatgpt-account-id"]).toBe("upstream-account");
    expect(request.headers["x-codex-feature"]).toBe("opaque");
    expect(request.headers.cookie).toBeUndefined();
  });

  it("proxies compact and models on the currently selected active account", async () => {
    const compact = Buffer.from('{"client_metadata":{"thread_id":"http-thread"},"opaque":"unchanged"}');
    const compactResult = await streamRequest(`${gatewayUrl}/backend-api/codex/responses/compact`, compact);
    expect(compactResult.status).toBe(200);
    expect(Buffer.concat(compactResult.chunks).equals(compact)).toBe(true);
    const models = await fetch(`${gatewayUrl}/backend-api/codex/models?client_version=0.147.0`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ data: [{ id: "mock-codex" }] });
    expect(models.headers.get("x-models-etag")).toBe("models-1");
    expect(received.findLast((entry) => entry.url.endsWith("/models?client_version=0.147.0"))).toBeTruthy();
    expect(received.findLast((entry) => entry.url.endsWith("/responses/compact"))!.headers.authorization).toBe("Bearer top-secret");

    gateway.activeAccounts.select("second");
    const switched = await streamRequest(`${gatewayUrl}/backend-api/codex/responses/compact`, compact);
    expect(switched.status).toBe(200);
    expect(received.findLast((entry) => entry.url.endsWith("/responses/compact"))!.headers.authorization).toBe("Bearer second-secret");
    gateway.activeAccounts.select("local");
  });
  it("refreshes the same account once on a pre-stream 401", async () => {
    const refresh = vi.spyOn(gateway.auth, "refresh").mockImplementation((id) => gateway.auth.getCredential(id));
    const result = await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, Buffer.from('{"cause401":true,"client_metadata":{"thread_id":"retry-thread"}}'));
    expect(result.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(received.filter((entry) => entry.body.includes(Buffer.from('"cause401":true')))).toHaveLength(2);
    refresh.mockRestore();
  });

  it("does not replay after stream start and transparently returns 429/compact errors", async () => {
    const refresh = vi.spyOn(gateway.auth, "refresh").mockImplementation((id) => gateway.auth.getCredential(id));
    const partial = await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, Buffer.from('{"partialAuthError":true,"client_metadata":{"thread_id":"partial-thread"}}'));
    expect(partial.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
    const limited = await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, Buffer.from('{"rate429":true,"client_metadata":{"thread_id":"rate-thread"}}'));
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBe("30");
    const compact = await streamRequest(`${gatewayUrl}/backend-api/codex/responses/compact`, Buffer.from('{"compactError":true,"client_metadata":{"thread_id":"partial-thread"}}'));
    expect(compact.status).toBe(422);
    expect(compact.headers["x-upstream-error"]).toBe("compact");
    expect(Buffer.concat(compact.chunks).toString()).toBe('{"error":"compact_invalid"}');
    refresh.mockRestore();
    gateway.database.accounts.update("local", { authStatus: "ready" });
  });

  it("carries an opaque multi-turn shell and file tool loop", async () => {
    const fixture = path.join(root, "tool-fixture.txt");
    await writeFile(fixture, "before");
    const first = Buffer.from('{"client_metadata":{"thread_id":"tool-thread"},"tools":[{"type":"function","name":"shell"},{"type":"function","name":"write_file"}],"input":"inspect"}');
    await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, first);
    const shell = await execFileAsync(process.execPath, ["-e", "process.stdout.write('shell-ok')"]);
    await writeFile(fixture, "after");
    const second = Buffer.from(JSON.stringify({ client_metadata: { thread_id: "tool-thread" }, input: [{ type: "function_call_output", call_id: "shell-1", output: shell.stdout }, { type: "function_call_output", call_id: "file-1", output: "after" }, { type: "reasoning", opaque: { future: true } }] }));
    await streamRequest(`${gatewayUrl}/backend-api/codex/responses`, second);
    const toolRequests = received.filter((entry) => entry.body.includes(Buffer.from('"thread_id":"tool-thread"')));
    expect(toolRequests.at(-2)!.body.equals(first)).toBe(true);
    expect(toolRequests.at(-1)!.body.equals(second)).toBe(true);
    expect(toolRequests.at(-1)!.body.toString()).toContain("shell-ok");
  });

  it("aborts the upstream when the downstream disconnects", async () => {
    await new Promise<void>((resolve, reject) => {
      const body = Buffer.from('{"slow":true,"client_metadata":{"thread_id":"cancel-thread"}}');
      const request = http.request(`${gatewayUrl}/backend-api/codex/responses`, { method: "POST", headers: { "content-type": "application/json", "content-length": String(body.length) } }, (response) => {
        response.once("data", () => { request.destroy(); resolve(); });
      });
      request.on("error", (error) => { if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error); });
      request.end(body);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(abortedSlowRequest).toBe(true);
  });
});

describe("WebSocket transport", () => {
  it("preserves upgrade metadata, immediate frames, ping/pong and close reason", async () => {
    const socket = new WebSocket(gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses", { headers: { "thread-id": "ws-thread" } });
    let upgradeHeaders: IncomingHttpHeaders = {};
    socket.on("upgrade", (response) => { upgradeHeaders = response.headers; });
    await once(socket, "open");
    const frame = '{"type":"response.create","client_metadata":{"thread_id":"ws-thread"},"future_item":{"x":1}}';
    socket.send(frame);
    const [echo] = await once(socket, "message");
    expect(echo.toString()).toBe(frame);
    expect(upgradeHeaders["x-models-etag"]).toBe("mock-etag");
    expect(upgradeHeaders["x-reasoning-included"]).toBe("true");
    expect(upgradeHeaders["openai-model"]).toBe("mock-codex");
    const pong = once(socket, "pong"); socket.ping("health"); await pong;
    socket.send("close-me");
    const [code, reason] = await once(socket, "close");
    expect(code).toBe(4001);
    expect(reason.toString()).toBe("mock_complete");
    expect(wsAccounts.at(-1)).toBe("upstream-account");
    const reconnect = new WebSocket(gatewayUrl.replace("http:", "ws:") + "/backend-api/codex/responses", { headers: { "thread-id": "ws-thread" } });
    await once(reconnect, "open");
    reconnect.close(1000, "done");
    await once(reconnect, "close");
    expect(wsAccounts.slice(-2)).toEqual(["upstream-account", "upstream-account"]);
  });
});

describe("security and admin API", () => {
  it("fails closed for unknown data routes and browser origins", async () => {
    const unknown = await fetch(`${gatewayUrl}/backend-api/codex/anything`);
    expect(unknown.status).toBe(501);
    const browser = await fetch(`${gatewayUrl}/backend-api/codex/models`, { headers: { origin: "https://evil.test" } });
    expect(browser.status).toBe(403);
  });

  it("requires same-origin CSRF and never exposes credential paths", async () => {
    const health = await fetch(`${gatewayUrl}/api/health`);
    const data = await health.json() as { csrfToken: string };
    const cookie = health.headers.get("set-cookie")!.split(";")[0];
    const accountsResponse = await (await fetch(`${gatewayUrl}/api/accounts`)).json() as { activeAccountId: string | null; accounts: Record<string, unknown>[] };
    expect(accountsResponse.activeAccountId).toBe("local");
    expect(accountsResponse.accounts[0]).not.toHaveProperty("codexHome");
    const rejected = await fetch(`${gatewayUrl}/api/settings`, { method: "PATCH", headers: { origin: "https://evil.test", cookie, "x-csrf-token": data.csrfToken, "content-type": "application/json" }, body: '{"theme":"dark"}' });
    expect(rejected.status).toBe(403);
    const accepted = await fetch(`${gatewayUrl}/api/settings`, { method: "PATCH", headers: { origin: gatewayUrl, cookie, "x-csrf-token": data.csrfToken, "content-type": "application/json" }, body: '{"theme":"dark"}' });
    expect(accepted.status).toBe(200);
    const proxiedOrigin = await fetch(`${gatewayUrl}/api/settings`, { method: "PATCH", headers: { origin: "http://127.0.0.1:5173", cookie, "x-csrf-token": data.csrfToken, "content-type": "application/json" }, body: '{"theme":"light"}' });
    expect(proxiedOrigin.status).toBe(200);
    const requestColumns = gateway.database.raw.prepare("PRAGMA table_info(request_log)").all() as { name: string }[];
    expect(requestColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["prompt", "response", "tool_arguments", "tool_output", "authorization"]));
    expect(accepted.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns an explicit 503 for models when no account is enabled", async () => {
    gateway.accounts.setEnabled("local", false);
    const response = await fetch(`${gatewayUrl}/backend-api/codex/models`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "no_active_account_selected" });
    gateway.accounts.setEnabled("local", true);
    gateway.activeAccounts.select("local");
  });
});
