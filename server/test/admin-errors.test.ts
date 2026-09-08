import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGateway } from "../src/app.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("admin error boundaries", () => {
  it("returns 400 for malformed JSON and hides unexpected error details", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "admin-errors-"));
    cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const gateway = await buildGateway({ dataDir: root, databasePath: path.join(root, "gateway.db"), accountsDir: path.join(root, "accounts"), loginStagingDir: path.join(root, "staging") }, { backgroundTasks: false });
    cleanup.push(() => gateway.app.close());
    const health = await gateway.app.inject({ url: "/api/health" });
    const headers = { origin: "http://localhost", cookie: String(health.headers["set-cookie"]).split(";")[0], "x-csrf-token": health.json().csrfToken, "content-type": "application/json" };
    const malformed = await gateway.app.inject({ method: "PATCH", url: "/api/accounts/missing", headers, payload: "{" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: "invalid_json_body" });
    vi.spyOn(gateway.accounts, "remove").mockRejectedValue(new Error("private filesystem detail"));
    const failed = await gateway.app.inject({ method: "DELETE", url: "/api/accounts/missing", headers: { origin: headers.origin, cookie: headers.cookie, "x-csrf-token": headers["x-csrf-token"] } });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: "internal_error" });
  });
});
