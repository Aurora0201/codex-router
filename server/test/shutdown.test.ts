import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { get, type ClientRequest, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGateway, type GatewayApp } from "../src/app.js";

let root: string;
let gateway: GatewayApp;
let client: ClientRequest | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "gateway-shutdown-"));
  gateway = await buildGateway(
    {
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: "http://127.0.0.1:1/backend-api/codex",
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      databasePath: path.join(root, "data", "gateway.db"),
    },
    { backgroundTasks: false },
  );
  await gateway.app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(async () => {
  client?.destroy();
  client = undefined;
  await gateway.app.close();
  await rm(root, { recursive: true, force: true });
});

describe("shutdown", () => {
  it("does not wait on an admin console that left its event stream open", async () => {
    const base = `http://127.0.0.1:${(gateway.app.server.address() as { port: number }).port}`;
    // A dedicated client avoids global fetch pool keep-alive cleanup being
    // measured as gateway SSE shutdown. No client abort happens before close.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      client = get(`${base}/api/events`, { agent: false }, resolve);
      client.once("error", reject);
    });
    expect(response.statusCode).toBe(200);
    // Read the first frame so the stream is unambiguously open and not idle.
    await once(response, "data");
    const ended = once(response, "end");

    // An SSE response never ends on its own, and Fastify waits for connections
    // that are not idle. Ten seconds is what the CLI gives a stop before it
    // reports failure, so anything near that is a hang.
    const startedAt = Date.now();
    await gateway.app.close();
    await ended;
    expect(response.complete).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
