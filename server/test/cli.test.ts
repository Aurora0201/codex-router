import http from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram, isEntryScript, isPortFree, startOverrides } from "../src/cli.js";
import { GatewayDatabase } from "../src/db/database.js";

const temporary: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  process.exitCode = 0;
  return Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const program = createProgram();
  await program.parseAsync(args, { from: "user" });
  const out = stdout.mock.calls.map((call) => String(call[0])).join("");
  const err = stderr.mock.calls.map((call) => String(call[0])).join("");
  stdout.mockRestore();
  stderr.mockRestore();
  return { stdout: out, stderr: err, exitCode: process.exitCode };
}

describe("startOverrides", () => {
  it("maps only the provided options", () => {
    expect(startOverrides({})).toEqual({});
    expect(startOverrides({ port: "9000", dev: true })).toEqual({ port: 9000, developerMode: true });
    expect(startOverrides({ host: "::1", dataDir: "x", upstream: "https://u", logLevel: "debug" })).toEqual({
      host: "::1",
      dataDir: path.resolve("x"),
      upstreamBaseUrl: "https://u",
    });
  });
});

describe("isEntryScript", () => {
  it("recognizes the running script by realpath", () => {
    const url = new URL(import.meta.url);
    expect(isEntryScript(fileURLToPath(url), url.href)).toBe(true);
    expect(isEntryScript("C:\\nonexistent\\elsewhere.js", url.href)).toBe(false);
    expect(isEntryScript(undefined, url.href)).toBe(false);
  });

  it("normalizes non-canonical argv paths before comparing", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "cli-entry.js");
    await writeFile(file, "");
    const nonCanonical = path.join(dir, "sub", "..", "cli-entry.js");
    expect(isEntryScript(nonCanonical, pathToFileURL(file).href)).toBe(true);
  });
});

describe("isPortFree", () => {
  it("reports an occupied port as not free", async () => {
    const server = http.createServer((_request, response) => response.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      expect(await isPortFree("127.0.0.1", port)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports a free port after the listener is released", async () => {
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await isPortFree("127.0.0.1", port)).toBe(true);
  });
});

describe("config commands", () => {
  it("config status reports the injection state", async () => {
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\n\nopenai_base_url = "http://127.0.0.1:8317/backend-api/codex"\n');
    vi.stubEnv("CODEX_HOME", home);
    const { stdout, exitCode } = await runCli(["config", "status"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("http://127.0.0.1:8317/backend-api/codex");
    expect(stdout).toContain("applied");
    expect(stdout).toContain("backup exists");
  });

  it("config apply injects the gateway url and restore reverts it", async () => {
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\n');
    vi.stubEnv("CODEX_HOME", home);

    const applied = await runCli(["config", "apply", "--host", "127.0.0.1", "--port", "8317"]);
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain("http://127.0.0.1:8317/backend-api/codex");
    expect(await readFile(path.join(home, "config.toml"), "utf8")).toContain("http://127.0.0.1:8317/backend-api/codex");

    const restored = await runCli(["config", "restore", "--host", "127.0.0.1", "--port", "8317"]);
    expect(restored.exitCode).toBe(0);
    expect(await readFile(path.join(home, "config.toml"), "utf8")).not.toContain("backend-api/codex");
  });

  it("config apply fails when the config file is missing", async () => {
    const home = await tempDir();
    vi.stubEnv("CODEX_HOME", home);
    const { stderr, exitCode } = await runCli(["config", "apply"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("codex_config_not_found");
  });
});

describe("status command", () => {
  it("reports a running gateway from its health and accounts API", async () => {
    const dataDir = await tempDir();
    const home = await tempDir();
    vi.stubEnv("CODEX_HOME", home);

    const server = http.createServer((request, response) => {
      if (request.url?.startsWith("/api/health")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "ok", upstream: "configured", accounts: 2, csrfToken: "t", version: "0.2.0", uptime: 3661, pid: 4242, dataDir }));
        return;
      }
      if (request.url?.startsWith("/api/accounts")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          activeAccountId: "cb33fd13-60cd-478d-b77c-f6e7ece226ef",
          accounts: [
            {
              id: "a3edf18c-53d7-45a5-941e-c41972c41b9a", email: "test@example.test", planType: "plus", authStatus: "ready", isActive: false,
              usage: { primary: { usedPercent: 32, resetsAt: 1, windowDurationMins: 10080 }, secondary: { usedPercent: null, resetsAt: null, windowDurationMins: 300 } },
            },
            {
              id: "cb33fd13-60cd-478d-b77c-f6e7ece226ef", email: "active@example.test", planType: "pro", authStatus: "ready", isActive: true,
              usage: { primary: { usedPercent: 50, resetsAt: 1, windowDurationMins: 10080 }, secondary: { usedPercent: 10, resetsAt: 1, windowDurationMins: 300 } },
            },
          ],
        }));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const { stdout, exitCode } = await runCli(["status", "--host", "127.0.0.1", "--port", String(port), "--data-dir", dataDir]);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(exitCode).toBe(0);
    expect(stdout).toContain("running");
    expect(stdout).toContain("uptime");
    expect(stdout).toContain("1h 1m 1s");
    expect(stdout).toContain("pid");
    expect(stdout).toContain("4242");
    expect(stdout).toContain("data");
    expect(stdout).toContain(dataDir);
    expect(stdout).toContain("quota · active cb33fd13…");
    expect(stdout).toContain("7d [");
    expect(stdout).toContain("5h [");
    expect(stdout).toContain("50% left");
    expect(stdout).toContain("90% left");
    expect(stdout).toContain("accounts (2)");
    expect(stdout).toContain("a3edf18c…");
    expect(stdout).toContain("test@example.test");
    expect(stdout).toContain("active@example.test");
    expect(stdout).toContain("plus");
    expect(stdout).toContain("pro");
    expect(stdout).toContain("[active]");
    expect(stdout).toContain("injected");
  });

  it("falls back to the local database when the gateway is down and omits quota", async () => {
    const dataDir = await tempDir();
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\n');
    vi.stubEnv("CODEX_HOME", home);

    const id = "cb33fd13-60cd-478d-b77c-f6e7ece226ef";
    const database = new GatewayDatabase(path.join(dataDir, "gateway.db"));
    database.accounts.insert({ id, codexHome: path.join(dataDir, "codex-home") });
    database.accounts.update(id, { authStatus: "ready", email: "test@example.test", planType: "plus", chatgptAccountId: "acc-1" });
    database.accounts.updateRateLimits(id, {
      primary: { usedPercent: 50, resetsAt: 1, windowDurationMins: 10080 },
      secondary: { usedPercent: 10, resetsAt: 1, windowDurationMins: 300 },
      rateLimitReachedType: null,
      loadedAt: Date.now(),
    });
    database.setActiveAccountId(id);
    database.close();

    const { stdout, exitCode } = await runCli(["status", "--host", "127.0.0.1", "--port", "1", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not running");
    expect(stdout).toContain("accounts (1)");
    expect(stdout).toContain("cb33fd13…");
    expect(stdout).toContain("test@example.test");
    expect(stdout).toContain("plus");
    expect(stdout).toContain("[active]");
    expect(stdout).not.toContain("quota · active");
    expect(stdout).toContain("codex-router start");
  });

  it("exits 1 when not running and shows no local state", async () => {
    const dataDir = await tempDir();
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\n');
    vi.stubEnv("CODEX_HOME", home);
    const { stdout, exitCode } = await runCli(["status", "--host", "127.0.0.1", "--port", "1", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not running");
    expect(stdout).toContain("accounts (0)");
    expect(stdout).toContain("codex-router start");
  });
});

describe("stop command", () => {
  it("cleans up a stale pid file", async () => {
    const dataDir = await tempDir();
    await writeFile(path.join(dataDir, "gateway.pid"), "999999999\n");
    const { stderr, exitCode } = await runCli(["stop", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("stale");
    await expect(access(path.join(dataDir, "gateway.pid"))).rejects.toThrow();
  });

  it("reports not running without a pid file", async () => {
    const dataDir = await tempDir();
    const { stderr, exitCode } = await runCli(["stop", "--host", "127.0.0.1", "--port", "1", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not running");
  });
});

describe("logs command", () => {
  it("prints the log file content", async () => {
    const dataDir = await tempDir();
    await mkdir(path.join(dataDir, "logs"), { recursive: true });
    await writeFile(path.join(dataDir, "logs", "gateway.log"), "line1\nline2\n");
    const { stdout, exitCode } = await runCli(["logs", "--data-dir", dataDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("line1");
    expect(stdout).toContain("line2");
  });

  it("reports when no log file exists", async () => {
    const dataDir = await tempDir();
    const { stderr, exitCode } = await runCli(["logs", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("no log file");
  });
});
