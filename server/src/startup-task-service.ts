import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { LaunchMetadata } from "./launch-metadata.js";

export const STARTUP_TASK_NAME = "Codex Router";

export type StartupTaskStatus = "enabled" | "disabled" | "not_registered";

export interface StartupTaskState {
  status: StartupTaskStatus;
  /** When Task Scheduler last ran it, or null when it never has. */
  lastRunAt: string | null;
  /**
   * Task Scheduler's own result for that run. 0 is success; anything else is
   * the task failing where nobody would see it. This is reported because the
   * previous version of this feature failed silently at every logon for weeks:
   * the task said "Ready", and only `LastTaskResult` knew otherwise.
   */
  lastResult: number | null;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

type CommandExecutor = (file: string, args: string[]) => Promise<CommandResult>;

interface StartupTaskServiceOptions {
  platform?: NodeJS.Platform;
  nodePath: string;
  entryPath: string;
  execute?: CommandExecutor;
}

const execFileAsync = promisify(execFile);

function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The task starts the gateway detached and returns.
 *
 * Running it in the foreground instead makes the task's PowerShell live as
 * long as the gateway, and that PowerShell owns a console. `-WindowStyle
 * Hidden` is a host preference applied once PowerShell is already up, so
 * whether the window is ever shown is a matter of timing; the detached shape
 * has no window to hide, because `start` spawns the gateway with the window
 * suppressed at creation and the wrapper is gone within a second.
 *
 * Losing sight of failures was the reason to move away from this. That is
 * `startup status`'s job now, which reports the task's own last result.
 */
function runtimeArguments(config: LaunchMetadata): string[] {
  const args = [
    "start",
    "--host", config.host,
    "--port", String(config.port),
    "--data-dir", config.dataDir,
    "--upstream", config.upstream,
  ];
  if (config.dev) args.push("--dev");
  if (config.logLevel) args.push("--log-level", config.logLevel);
  return args;
}

export function startupRuntimeScript(nodePath: string, entryPath: string, config: LaunchMetadata): string {
  const args = [entryPath, ...runtimeArguments(config)].map(psLiteral).join(", ");
  const logLevel = config.logLevel
    ? `$env:GATEWAY_LOG_LEVEL = ${psLiteral(config.logLevel)}`
    : "Remove-Item Env:GATEWAY_LOG_LEVEL -ErrorAction SilentlyContinue";
  return [
    "$ErrorActionPreference = 'Stop'",
    logLevel,
    `$arguments = @(${args})`,
    // Nothing to capture: the detached gateway's output already goes to the
    // log file, and PowerShell's own redirection would write it in UTF-16.
    `& ${psLiteral(nodePath)} @arguments *> $null`,
    "exit $LASTEXITCODE",
  ].join("\n");
}

export function startupRegistrationScript(nodePath: string, entryPath: string, config: LaunchMetadata): string {
  const runtime = encodePowerShell(startupRuntimeScript(nodePath, entryPath, config));
  const actionArgs = `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${runtime}`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name",
    `$action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument ${psLiteral(actionArgs)} -WorkingDirectory ${psLiteral(path.dirname(entryPath))}`,
    "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId",
    "$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited",
    "$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries",
    `Register-ScheduledTask -TaskName ${psLiteral(STARTUP_TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null`,
  ].join("\n");
}

export function startupStatusScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskName ${psLiteral(STARTUP_TASK_NAME)} -ErrorAction SilentlyContinue`,
    "if ($null -eq $task) { '{\"status\":\"not_registered\",\"lastRunAt\":null,\"lastResult\":null}'; exit 0 }",
    `$info = Get-ScheduledTaskInfo -TaskName ${psLiteral(STARTUP_TASK_NAME)} -ErrorAction SilentlyContinue`,
    "$status = if ($task.State -eq 'Disabled') { 'disabled' } else { 'enabled' }",
    "$ran = if ($info -and $info.LastRunTime -and $info.LastRunTime.Year -gt 1999) { $info.LastRunTime.ToString('o') } else { $null }",
    "$result = if ($info) { [int64]$info.LastTaskResult } else { $null }",
    "[pscustomobject]@{ status = $status; lastRunAt = $ran; lastResult = $result } | ConvertTo-Json -Compress",
  ].join("\n");
}

function parseState(stdout: string): StartupTaskState {
  const parsed: unknown = JSON.parse(stdout.trim());
  if (typeof parsed !== "object" || parsed === null) throw new Error("startup_task_status_invalid");
  const row = parsed as Record<string, unknown>;
  const status = row.status;
  if (status !== "enabled" && status !== "disabled" && status !== "not_registered") {
    throw new Error("startup_task_status_invalid");
  }
  return {
    status,
    lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
    lastResult: typeof row.lastResult === "number" ? row.lastResult : null,
  };
}

function defaultExecutor(file: string, args: string[]): Promise<CommandResult> {
  return execFileAsync(file, args, { windowsHide: true, encoding: "utf8" }) as Promise<CommandResult>;
}

export class StartupTaskService {
  private readonly platform: NodeJS.Platform;
  private readonly execute: CommandExecutor;

  constructor(private readonly options: StartupTaskServiceOptions) {
    this.platform = options.platform ?? process.platform;
    this.execute = options.execute ?? defaultExecutor;
  }

  async enable(config: LaunchMetadata): Promise<void> {
    this.assertWindows();
    await this.run(startupRegistrationScript(this.options.nodePath, this.options.entryPath, config));
  }

  async disable(): Promise<void> {
    this.assertWindows();
    await this.run([
      "$ErrorActionPreference = 'Stop'",
      `Unregister-ScheduledTask -TaskName ${psLiteral(STARTUP_TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue`,
    ].join("\n"));
  }

  async status(): Promise<StartupTaskState> {
    this.assertWindows();
    return parseState((await this.run(startupStatusScript())).stdout);
  }

  private assertWindows(): void {
    if (this.platform !== "win32") throw new Error("startup_windows_only");
  }

  private run(script: string): Promise<CommandResult> {
    return this.execute("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodePowerShell(script),
    ]).catch((error) => {
      throw new Error("startup_task_command_failed", { cause: error });
    });
  }
}
