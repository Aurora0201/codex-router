import http from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accountChoices, createProgram, isEntryScript, isPortFree, restartOptions, startOverrides, stopManagedGateway } from "../src/cli.js";
import { GatewayDatabase } from "../src/db/database.js";
import { launchMetadataPath, parseLaunchMetadata, readLaunchMetadata, writeLaunchMetadata } from "../src/launch-metadata.js";

const temporary: string[] = [];
const selectMock = vi.hoisted(() => vi.fn());

vi.mock("@inquirer/select", () => ({ default: selectMock }));

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  selectMock.mockReset();
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

async function withTty<T>(isTty: boolean, operation: () => Promise<T>): Promise<T> {
  const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: isTty });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTty });
  try {
    return await operation();
  } finally {
    if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    else delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
  }
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

describe("restart launch metadata", () => {
  it("round-trips versioned background start options", async () => {
    const dataDir = await tempDir();
    const logFile = path.join(dataDir, "logs", "custom.log");
    const metadata = {
      version: 1 as const,
      host: "::1" as const,
      port: 9444,
      dataDir,
      upstream: "https://example.test/backend-api/codex",
      dev: true,
      logLevel: "debug",
      logFile,
    };
    await writeLaunchMetadata(dataDir, metadata);
    expect(await readLaunchMetadata(dataDir)).toEqual(metadata);
    expect(launchMetadataPath(dataDir)).toBe(path.join(dataDir, "gateway-start.json"));
  });

  it("ignores malformed, unknown-version and unexpected metadata", () => {
    const valid = { version: 1, host: "127.0.0.1", port: 8317, dataDir: path.resolve("data"), upstream: "https://chatgpt.com/backend-api/codex", dev: false, logFile: path.resolve("gateway.log") };
    expect(parseLaunchMetadata({ ...valid, version: 2 })).toBeNull();
    expect(parseLaunchMetadata({ ...valid, port: 0 })).toBeNull();
    expect(parseLaunchMetadata({ ...valid, unexpected: true })).toBeNull();
    expect(parseLaunchMetadata({ ...valid, upstream: "https://token@example.test" })).toBeNull();
  });

  it("falls back when the saved metadata file is malformed", async () => {
    const dataDir = await tempDir();
    await writeFile(launchMetadataPath(dataDir), "{not-json");
    expect(await readLaunchMetadata(dataDir)).toBeNull();
  });

  it("lets explicit restart flags override saved options", () => {
    const dataDir = path.resolve("restart-data");
    const saved = {
      version: 1 as const,
      host: "127.0.0.1" as const,
      port: 8317,
      dataDir,
      upstream: "https://saved.test/codex",
      dev: true,
      logLevel: "info",
      logFile: path.join(dataDir, "saved.log"),
    };
    expect(restartOptions({ port: "9444", logLevel: "warn" }, saved, dataDir)).toEqual({
      host: "127.0.0.1",
      port: "9444",
      dataDir,
      upstream: "https://saved.test/codex",
      dev: true,
      logLevel: "warn",
      logFile: path.join(dataDir, "saved.log"),
    });
  });

  it("registers restart with the background start override flags", () => {
    const restart = createProgram().commands.find((command) => command.name() === "restart");
    expect(restart).toBeDefined();
    expect(restart?.options.map((option) => option.long)).toEqual(expect.arrayContaining(["--host", "--port", "--data-dir", "--upstream", "--dev", "--log-level", "--log-file"]));
    expect(restart?.description()).toContain("preserving");
  });
});

describe("restart stop preparation", () => {
  it("allows restart to start when there is no pid and the port is free", async () => {
    const dataDir = await tempDir();
    expect(await stopManagedGateway({ host: "127.0.0.1", port: "1", dataDir }, true)).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("cleans a stale pid before restart", async () => {
    const dataDir = await tempDir();
    await writeFile(path.join(dataDir, "gateway.pid"), "999999999\n");
    expect(await stopManagedGateway({ host: "127.0.0.1", port: "1", dataDir }, true)).toBe(true);
    await expect(access(path.join(dataDir, "gateway.pid"))).rejects.toThrow();
  });

  it("refuses to restart an unmanaged listener", async () => {
    const dataDir = await tempDir();
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      expect(await stopManagedGateway({ host: "127.0.0.1", port: String(port), dataDir }, true)).toBe(false);
      expect(process.exitCode).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
    await writeFile(path.join(home, "config.toml"), 'openai_base_url = "http://127.0.0.1:8317/backend-api/codex"\n');
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
    expect(stdout).toContain(`Admin    http://127.0.0.1:${port}/admin`);
    expect(stdout).toContain("PID      4242");
    expect(stdout).toContain("Uptime   1h 1m");
    expect(stdout).toContain(`Data     ${dataDir}`);
    expect(stdout).toContain("Config   ○ not injected");
    expect(stdout).toContain("Current  active@example.test · pro · cb33fd13…");
    expect(stdout).toContain("7d       [█████░░░░░] 50% remaining");
    expect(stdout).toContain("5h       [█████████░] 90% remaining");
    expect(stdout).not.toContain("test@example.test");
    expect(stdout).toContain("active@example.test");
  });

  it("falls back to the local database and labels cached quota when the gateway is down", async () => {
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
    expect(stdout).toContain("PID      —");
    expect(stdout).toContain("Uptime   —");
    expect(stdout).toContain(`Data     ${dataDir}`);
    expect(stdout).toContain("Config   ○ not injected");
    expect(stdout).toContain("Current  test@example.test · plus · cb33fd13… (cached)");
    expect(stdout).toContain("7d       [█████░░░░░] 50% remaining (cached)");
    expect(stdout).toContain("5h       [█████████░] 90% remaining (cached)");
  });

  it("exits 1 when not running and shows no local state", async () => {
    const dataDir = await tempDir();
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'model = "gpt-5.6-luna"\n');
    vi.stubEnv("CODEX_HOME", home);
    const { stdout, exitCode } = await runCli(["status", "--host", "127.0.0.1", "--port", "1", "--data-dir", dataDir]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("not running");
    expect(stdout).toContain("Current  none");
  });
});

describe("account command", () => {
  const activeId = "cb33fd13-60cd-478d-b77c-f6e7ece226ef";
  const nextId = "a3edf18c-53d7-45a5-941e-c41972c41b9a";
  const accounts = [
    {
      id: activeId, email: "active@example.test", planType: "pro", authStatus: "ready", enabled: true, isActive: true,
      usage: { primary: { usedPercent: 50, windowDurationMins: 10080 }, secondary: { usedPercent: 10, windowDurationMins: 300 } },
    },
    {
      id: nextId, email: "next@example.test", planType: "plus", authStatus: "ready", enabled: true, isActive: false,
      usage: { primary: { usedPercent: 20, windowDurationMins: 10080 }, secondary: { usedPercent: null, windowDurationMins: 300 } },
    },
  ];

  async function startAccountServer(onPut?: (request: http.IncomingMessage, body: string) => void) {
    const server = http.createServer((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(200, { "content-type": "application/json", "set-cookie": "cg_csrf=token-1; Path=/; SameSite=Strict" });
        response.end(JSON.stringify({ status: "ok", csrfToken: "token-1" }));
        return;
      }
      if (request.url === "/api/accounts") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ activeAccountId: activeId, accounts }));
        return;
      }
      if (request.url === "/api/active-account" && request.method === "PUT") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          onPut?.(request, body);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(accounts[1]));
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, port: (server.address() as { port: number }).port };
  }

  it("builds selectable choices and disables unavailable accounts with a reason", () => {
    const choices = accountChoices([
      ...accounts,
      { ...accounts[1], id: "disabled", enabled: false, isActive: false },
      { ...accounts[1], id: "relogin", enabled: true, authStatus: "relogin_required", isActive: false },
    ]);
    expect(choices[0]).toMatchObject({ value: activeId, disabled: undefined });
    expect(choices[0].name).toContain("current");
    expect(choices[2]).toMatchObject({ value: "disabled", disabled: "disabled" });
    expect(choices[3]).toMatchObject({ value: "relogin", disabled: "login required" });
  });

  it("switches by ID through the CSRF-protected gateway API", async () => {
    let received: { origin?: string; cookie?: string; csrf?: string; body?: string } = {};
    const { server, port } = await startAccountServer((request, body) => {
      received = {
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        csrf: request.headers["x-csrf-token"] as string,
        body,
      };
    });
    try {
      const result = await runCli(["account", nextId, "--port", String(port)]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("current account: next@example.test · plus · a3edf18c…");
      expect(received).toEqual({
        origin: `http://127.0.0.1:${port}`,
        cookie: "cg_csrf=token-1",
        csrf: "token-1",
        body: JSON.stringify({ id: nextId }),
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses the active account as the interactive default and does not loop", async () => {
    selectMock.mockResolvedValue(nextId);
    const { server, port } = await startAccountServer();
    try {
      const result = await withTty(true, () => runCli(["account", "--port", String(port)]));
      expect(result.exitCode).toBe(0);
      expect(selectMock).toHaveBeenCalledWith(expect.objectContaining({ default: activeId, loop: false }));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires an account ID outside an interactive terminal", async () => {
    const { server, port } = await startAccountServer();
    try {
      const result = await withTty(false, () => runCli(["account", "--port", String(port)]));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("account <account-id>");
      expect(selectMock).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("handles Ctrl+C without printing a stack trace", async () => {
    const cancelled = new Error("User force closed the prompt");
    cancelled.name = "ExitPromptError";
    selectMock.mockRejectedValue(cancelled);
    const { server, port } = await startAccountServer();
    try {
      const result = await withTty(true, () => runCli(["account", "--port", String(port)]));
      expect(result.exitCode).toBe(130);
      expect(result.stderr).toBe("[codex-router] account selection cancelled\n");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not send a switch request when the selected account is already current", async () => {
    const onPut = vi.fn();
    const { server, port } = await startAccountServer(onPut);
    try {
      const result = await runCli(["account", activeId, "--port", String(port)]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("already the current account");
      expect(onPut).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("requires a running gateway", async () => {
    const result = await runCli(["account", nextId, "--port", "1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("gateway is not running");
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
