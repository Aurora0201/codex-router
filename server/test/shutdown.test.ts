import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGateway, type GatewayApp } from "../src/app.js";

let root: string;
let gateway: GatewayApp;

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
  await rm(root, { recursive: true, force: true });
});

describe("shutdown", () => {
  it("does not wait on an admin console that left its event stream open", async () => {
    const base = `http://127.0.0.1:${(gateway.app.server.address() as { port: number }).port}`;
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    // Read the first frame so the stream is unambiguously open and not idle.
    const reader = response.body!.getReader();
    await reader.read();

    // An SSE response never ends on its own, and Fastify waits for connections
    // that are not idle. Ten seconds is what the CLI gives a stop before it
    // reports failure, so anything near that is a hang.
    const startedAt = Date.now();
    await gateway.app.close();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    controller.abort();
  });
});
