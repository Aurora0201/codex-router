import { describe, expect, it, vi } from "vitest";
import {
  STARTUP_TASK_NAME,
  StartupTaskService,
  startupRegistrationScript,
  startupRuntimeScript,
} from "../src/startup-task-service.js";
import type { LaunchMetadata } from "../src/launch-metadata.js";

const config: LaunchMetadata = {
  version: 1,
  host: "127.0.0.1",
  port: 8317,
  // Apostrophes and spaces are ordinary in a Windows profile path and are the
  // one thing that breaks a hand-built PowerShell literal.
  dataDir: "C:\\Users\\Example User\\router's data",
  upstream: "https://chatgpt.com/backend-api/codex",
  dev: false,
  logLevel: "info",
  logFile: "C:\\Users\\Example User\\router's data\\logs\\gateway.log",
};

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const ENTRY = "C:\\Program Files\\codex-router\\dist\\cli.js";

function decodeCommand(args: string[]): string {
  const encoded = args.at(-1);
  if (!encoded) throw new Error("missing encoded command");
  return Buffer.from(encoded, "base64").toString("utf16le");
}

function service(execute: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>) {
  return new StartupTaskService({ platform: "win32", nodePath: NODE, entryPath: ENTRY, execute });
}

describe("Windows startup task service", () => {
  it("runs the gateway itself rather than the background starter", () => {
    const script = startupRuntimeScript(NODE, ENTRY, config);

    // `start` without --foreground spawns a child, waits five seconds for it
    // to answer and kills it otherwise. Three processes deep inside a task
    // that is not watching, that failure is invisible — which is exactly how
    // this went unnoticed for weeks.
    expect(script).toContain("'start', '--foreground'");
    expect(script).toContain("'--data-dir', 'C:\\Users\\Example User\\router''s data'");
    expect(script).toContain("'--upstream', 'https://chatgpt.com/backend-api/codex'");
    expect(script).toContain("$env:GATEWAY_LOG_LEVEL = 'info'");
  });

  it("leaves the log file to the gateway rather than redirecting into it", () => {
    const script = startupRuntimeScript(NODE, ENTRY, config);
    // PowerShell 5.1 writes `*>>` in UTF-16, and piping through Out-File wraps
    // anything on stderr in an error record. The gateway is handed the path
    // and opens it itself, so no shell is in the log's way.
    expect(script).toContain("$env:GATEWAY_LOG_FILE = 'C:\\Users\\Example User\\router''s data\\logs\\gateway.log'");
    expect(script).toContain("@arguments *> $null");
    expect(script).not.toContain("*>>");
  });

  it("drops the log level line when there is none to set", () => {
    const script = startupRuntimeScript(NODE, ENTRY, { ...config, logLevel: undefined });
    expect(script).toContain("Remove-Item Env:GATEWAY_LOG_LEVEL");
    expect(script).not.toContain("$env:GATEWAY_LOG_LEVEL =");
  });

  it("passes --dev through, since a custom upstream is refused without it", () => {
    expect(startupRuntimeScript(NODE, ENTRY, { ...config, dev: true })).toContain("'--dev'");
    expect(startupRuntimeScript(NODE, ENTRY, config)).not.toContain("'--dev'");
  });

  it("registers a least-privilege current-user logon task with bounded recovery", () => {
    const script = startupRegistrationScript(NODE, ENTRY, config);
    expect(script).toContain("New-ScheduledTaskTrigger -AtLogOn -User $userId");
    expect(script).toContain("-LogonType Interactive -RunLevel Limited");
    expect(script).toContain("-RestartCount 3");
    expect(script).toContain("-MultipleInstances IgnoreNew");
    expect(script).toContain(`-TaskName '${STARTUP_TASK_NAME}'`);
    // The gateway is long-lived, so a time limit would kill it mid-day.
    expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
  });

  it("reads back the last run and its result, not just whether it is registered", async () => {
    const execute = vi.fn(async () => ({
      stdout: '{"status":"enabled","lastRunAt":"2026-09-08T10:31:52.0000000+08:00","lastResult":-1}\n',
      stderr: "",
    }));
    expect(await service(execute).status()).toEqual({
      status: "enabled",
      lastRunAt: "2026-09-08T10:31:52.0000000+08:00",
      lastResult: -1,
    });
  });

  it("reports a task nobody has registered without inventing a run", async () => {
    const execute = vi.fn(async () => ({
      stdout: '{"status":"not_registered","lastRunAt":null,"lastResult":null}',
      stderr: "",
    }));
    expect(await service(execute).status()).toEqual({
      status: "not_registered",
      lastRunAt: null,
      lastResult: null,
    });
  });

  it("refuses to read a status it does not understand", async () => {
    const execute = vi.fn(async () => ({ stdout: '{"status":"maybe"}', stderr: "" }));
    await expect(service(execute).status()).rejects.toThrow("startup_task_status_invalid");
  });

  it("turns a Task Scheduler failure into one error the CLI can explain", async () => {
    const execute = vi.fn(async () => {
      throw new Error("Access is denied");
    });
    await expect(service(execute).enable(config)).rejects.toThrow("startup_task_command_failed");
  });

  it("does nothing anywhere but Windows", async () => {
    const elsewhere = new StartupTaskService({
      platform: "darwin",
      nodePath: NODE,
      entryPath: ENTRY,
      execute: async () => ({ stdout: "", stderr: "" }),
    });
    await expect(elsewhere.enable(config)).rejects.toThrow("startup_windows_only");
    await expect(elsewhere.disable()).rejects.toThrow("startup_windows_only");
    await expect(elsewhere.status()).rejects.toThrow("startup_windows_only");
  });

  it("hands PowerShell a base64 command rather than a quoted one", async () => {
    const execute = vi.fn(async () => ({ stdout: "", stderr: "" }));
    await service(execute).disable();
    const [file, args] = execute.mock.calls[0] as unknown as [string, string[]];
    expect(file).toBe("powershell.exe");
    expect(args).toContain("-NonInteractive");
    expect(decodeCommand(args)).toContain(`Unregister-ScheduledTask -TaskName '${STARTUP_TASK_NAME}'`);
  });
});
