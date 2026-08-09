#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, stat } from "node:fs/promises";
import { accessSync, realpathSync, watch } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { startGateway } from "./index.js";
import { BACKUP_NAME, CodexConfigService, type CodexConfigStatus } from "./codex/codex-config.js";
import { loadConfig } from "./config.js";
import { GatewayDatabase } from "./db/database.js";
import { printBanner } from "./banner.js";
import { isProcessAlive, readPidFile, removePidFile } from "./pid.js";
import type { AccountRecord, GatewayConfig } from "./types.js";

const require = createRequire(import.meta.url);
const VERSION = (require("../package.json").version as string) ?? "0.0.0";

const ENTRY_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(ENTRY_PATH), "..", "..");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8317;

function resolveDataDir(option: string | undefined): string {
  return path.resolve(option ?? process.env.GATEWAY_DATA_DIR ?? path.join(ROOT, "data"));
}

function parsePortOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return port;
}

function resolveHostPort(host: string | undefined, port: string | undefined): { host: string; port: number } {
  return { host: host ?? DEFAULT_HOST, port: parsePortOption(port) ?? DEFAULT_PORT };
}

function out(text = ""): void {
  process.stdout.write(`${text}\n`);
}

function err(text = ""): void {
  process.stderr.write(`${text}\n`);
}

// --- start ----------------------------------------------------------------

interface StartOptions {
  foreground?: boolean;
  host?: string;
  port?: string;
  dataDir?: string;
  upstream?: string;
  dev?: boolean;
  logLevel?: string;
  logFile?: string;
}

export function startOverrides(options: StartOptions): Partial<GatewayConfig> {
  const overrides: Partial<GatewayConfig> = {};
  if (options.host !== undefined) overrides.host = options.host as GatewayConfig["host"];
  if (options.port !== undefined) overrides.port = parsePortOption(options.port);
  if (options.dataDir !== undefined) overrides.dataDir = path.resolve(options.dataDir);
  if (options.upstream !== undefined) overrides.upstreamBaseUrl = options.upstream;
  if (options.dev) overrides.developerMode = true;
  return overrides;
}

async function waitForHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (free: boolean) => {
      socket.destroy();
      resolve(free);
    };
    socket.once("connect", () => done(false));
    socket.once("error", () => done(true));
  });
}

async function startInBackground(overrides: Partial<GatewayConfig>, logFileOption?: string): Promise<void> {
  const config = loadConfig(overrides);

  if (!(await isPortFree(config.host, config.port))) {
    err(`[codex-router] failed to start: port ${config.port} is already in use`);
    err(`[codex-router] is a gateway already running? check with: codex-router status`);
    process.exitCode = 1;
    return;
  }

  const logDir = path.join(config.dataDir, "logs");
  await mkdir(logDir, { recursive: true });
  const logFile = path.resolve(logFileOption ?? path.join(logDir, "gateway.log"));
  const logFd = await open(logFile, "a");

  const args = [
    ENTRY_PATH,
    "start",
    "--foreground",
    "--host", config.host,
    "--port", String(config.port),
    "--data-dir", config.dataDir,
  ];
  if (overrides.upstreamBaseUrl) args.push("--upstream", overrides.upstreamBaseUrl);
  if (overrides.developerMode) args.push("--dev");

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
    windowsHide: true,
  });
  await logFd.close();
  child.unref();

  let childExited = false;
  child.once("exit", () => {
    childExited = true;
  });

  const started = await waitForHealth(config.host, config.port, 5_000);
  if (childExited || !started) {
    err("[codex-router] failed to start in the background");
    err("[codex-router] check the log file for details:");
    err(`  ${logFile}`);
    try {
      child.kill();
    } catch {
      // ignore
    }
    process.exitCode = 1;
    return;
  }

  out(`[codex-router] started in background`);
  out(`  pid:   ${child.pid ?? "?"}`);
  out(`  url:   http://${config.host}:${config.port}`);
  out(`  admin: http://${config.host}:${config.port}/admin`);
  out(`  data:  ${config.dataDir}`);
  out(`  log:   ${logFile}`);
  out(`[codex-router] show logs with:  codex-router logs --tail`);
}

async function actionStart(options: StartOptions): Promise<void> {
  if (options.logLevel !== undefined) process.env.GATEWAY_LOG_LEVEL = options.logLevel;
  const overrides = startOverrides(options);
  printBanner();
  if (options.foreground) {
    await startGateway(overrides);
    return;
  }
  await startInBackground(overrides, options.logFile);
}

// --- status ---------------------------------------------------------------

const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
} as const;

function useColor(): boolean {
  return process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
}

function paint(enabled: boolean, color: keyof typeof ANSI, text: string): string {
  return enabled ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

function formatUptime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function openDatabase(dataDir: string): GatewayDatabase | null {
  const databasePath = path.join(dataDir, "gateway.db");
  try {
    accessSync(databasePath);
    return new GatewayDatabase(databasePath);
  } catch {
    return null;
  }
}

function accountSymbol(status: string, color: boolean): string {
  switch (status) {
    case "ready": return paint(color, "green", "✔");
    case "rate_limited": return paint(color, "yellow", "⚠");
    case "relogin_required":
    case "login_pending":
    case "refreshing": return paint(color, "yellow", "◌");
    default: return paint(color, "red", "✖");
  }
}

function summarizeAccounts(accounts: { authStatus: string }[]): string {
  const counts = new Map<string, number>();
  for (const account of accounts) counts.set(account.authStatus, (counts.get(account.authStatus) ?? 0) + 1);
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return parts.length > 0 ? parts.join(" · ") : "0 accounts";
}

function shortAccountId(id: string): string {
  return id.length <= 9 ? id : `${id.slice(0, 8)}…`;
}

function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function quotaBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatQuota(window?: UsageWindow | null): string {
  if (!window || window.windowDurationMins == null) return "—";
  const label = windowLabel(window.windowDurationMins);
  if (window.usedPercent == null) return `${label} ${quotaBar(0)} —`;
  const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
  return `${label} ${quotaBar(remaining)} ${remaining}% left`;
}

interface StatusOptions {
  host?: string;
  port?: string;
  dataDir?: string;
}

interface HealthPayload {
  version?: string;
  accounts?: number;
  uptime?: number;
  pid?: number;
  dataDir?: string;
}

interface UsageWindow {
  usedPercent?: number | null;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

interface RemoteUsage {
  primary?: UsageWindow | null;
  secondary?: UsageWindow | null;
}

interface AccountSummary {
  id: string;
  email?: string | null;
  planType?: string | null;
  authStatus: string;
  usage?: RemoteUsage | null;
}

function fromAccountRecord(account: AccountRecord): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    planType: account.planType,
    authStatus: account.authStatus,
    usage: {
      primary: {
        usedPercent: account.primaryUsedPercent,
        resetsAt: account.primaryResetsAt,
        windowDurationMins: account.primaryWindowMinutes,
      },
      secondary: {
        usedPercent: account.secondaryUsedPercent,
        resetsAt: account.secondaryResetsAt,
        windowDurationMins: account.secondaryWindowMinutes,
      },
    },
  };
}

async function actionStatus(options: StatusOptions): Promise<void> {
  const { host, port } = resolveHostPort(options.host, options.port);
  const dataDir = resolveDataDir(options.dataDir);
  const color = useColor();

  let health: HealthPayload | null = null;
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) health = (await response.json()) as HealthPayload;
  } catch {
    health = null;
  }

  let remoteAccounts: AccountSummary[] | null = null;
  let remoteActiveId: string | null = null;
  if (health) {
    try {
      const response = await fetch(`http://${host}:${port}/api/accounts`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const body = (await response.json()) as { activeAccountId: string | null; accounts: AccountSummary[] };
        remoteAccounts = body.accounts;
        remoteActiveId = body.activeAccountId;
      }
    } catch {
      remoteAccounts = null;
    }
  }

  const pid = health?.pid ?? (await readPidFile(dataDir));
  const effectiveDataDir = health?.dataDir ?? dataDir;

  let config: CodexConfigStatus | null = null;
  try {
    config = await new CodexConfigService().status(host, port);
  } catch {
    config = null;
  }

  const database = remoteAccounts ? null : openDatabase(dataDir);
  const accounts: AccountSummary[] = remoteAccounts ?? (database?.accounts.list() ?? []).map(fromAccountRecord);
  const activeAccountId = remoteActiveId ?? database?.getActiveAccountId() ?? null;
  database?.close();

  if (health) {
    out(`${paint(color, "green", "●")} codex-router — running (v${health.version ?? "?"})`);
  } else {
    out(`${paint(color, "yellow", "○")} codex-router — not running`);
  }
  out("│");
  out(`│  url      : http://${host}:${port}`);
  out(`│  admin    : http://${host}:${port}/admin`);
  if (health) {
    out(`│  pid      : ${pid ?? "?"}`);
    out(`│  uptime   : ${formatUptime(health.uptime ?? 0)}`);
    out(`│  data     : ${effectiveDataDir}`);
  }
  out("│");

  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  if (health && activeAccount) {
    out(`├─ quota · active ${shortAccountId(activeAccount.id)}`);
    out(`│  ${formatQuota(activeAccount.usage?.primary)}`);
    out(`│  ${formatQuota(activeAccount.usage?.secondary)}`);
    out("│");
  }

  out("├─ config");
  if (config) {
    const injected = config.applied && config.openaiBaseUrl === config.gatewayBaseUrl;
    out(`│  │  config path : ${config.configPath}`);
    out(`│  │  gateway url : ${config.gatewayBaseUrl}`);
    if (injected) {
      out(`│  │  injected    : ${paint(color, "green", "✓")} (openai_base_url → gateway)`);
    } else {
      out(`│  │  injected    : ${paint(color, "red", "✗")} (openai_base_url → ${config.openaiBaseUrl ?? "(not set)"})`);
    }
    out(`│  │  backup      : ${config.hasBackup ? paint(color, "green", "✓") : paint(color, "yellow", "—")}`);
    out(`│  └─ manage: codex-router config apply | restore`);
  } else {
    out(`│  └─ (unavailable)`);
  }
  out("│");

  out(`├─ accounts (${accounts.length})`);
  if (accounts.length === 0) {
    out(`│  └─ (no accounts)`);
  } else {
    for (const account of accounts) {
      const active = account.id === activeAccountId;
      const marker = active ? paint(color, "green", "●") : paint(color, "cyan", "○");
      const symbol = accountSymbol(account.authStatus, color);
      const tag = active ? "  [active]" : "";
      const plan = (account.planType ?? "").padEnd(6);
      out(`│  ├─ ${marker} ${shortAccountId(account.id).padEnd(10)} ${(account.email ?? "-").padEnd(24)} ${plan}${symbol}${tag}`);
    }
    out(`│  └─ ${summarizeAccounts(accounts)}`);
  }
  out("│");

  if (health) {
    out(`└─ healthy`);
  } else {
    out(`└─ start it with ${paint(color, "cyan", "`codex-router start`")}`);
    process.exitCode = 1;
  }
}

// --- stop -----------------------------------------------------------------

function isPortOpen(host: string, port: number): Promise<boolean> {
  return fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((response) => response.ok)
    .catch(() => false);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function actionStop(options: StatusOptions): Promise<void> {
  const { host, port } = resolveHostPort(options.host, options.port);
  const dataDir = resolveDataDir(options.dataDir);

  const pid = await readPidFile(dataDir);
  if (pid === null) {
    if (await isPortOpen(host, port)) {
      err("[codex-router] gateway is listening but has no pid file; it was started outside the CLI — stop it with Ctrl+C");
    } else {
      err("[codex-router] status: not running (no pid file)");
    }
    process.exitCode = 1;
    return;
  }
  if (!isProcessAlive(pid)) {
    await removePidFile(dataDir);
    err(`[codex-router] cleaning up stale pid file (pid ${pid} not running)`);
    process.exitCode = 1;
    return;
  }

  out(`[codex-router] stopping (pid ${pid})`);
  process.kill(pid, "SIGTERM");
  const stopped = await waitForProcessExit(pid, 10_000);
  if (!stopped) {
    err(`[codex-router] failed to stop within 10s (pid ${pid})`);
    process.exitCode = 1;
    return;
  }
  await removePidFile(dataDir);
  out("[codex-router] stopped");
}

// --- logs -----------------------------------------------------------------

interface LogsOptions {
  tail?: boolean;
  dataDir?: string;
}

async function actionLogs(options: LogsOptions): Promise<void> {
  const dataDir = resolveDataDir(options.dataDir);
  const logFile = path.join(dataDir, "logs", "gateway.log");
  try {
    await access(logFile);
  } catch {
    err(`[codex-router] no log file yet (${logFile})`);
    process.exitCode = 1;
    return;
  }
  const content = await readFile(logFile, "utf8");
  process.stdout.write(content.endsWith("\n") ? content : `${content}\n`);
  if (options.tail) await followFile(logFile);
}

async function followFile(filePath: string): Promise<void> {
  let size = (await stat(filePath)).size;
  const watcher = watch(filePath, () => {
    void (async () => {
      try {
        const current = (await stat(filePath)).size;
        if (current < size) size = 0;
        if (current > size) {
          const handle = await open(filePath, "r");
          try {
            const buffer = Buffer.alloc(current - size);
            await handle.read(buffer, 0, buffer.length, size);
            process.stdout.write(buffer.toString());
          } finally {
            await handle.close();
          }
          size = current;
        }
      } catch {
        // file temporarily unavailable
      }
    })();
  });
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      watcher.close();
      resolve();
    });
    process.once("SIGTERM", () => {
      watcher.close();
      resolve();
    });
  });
}

// --- config ---------------------------------------------------------------

function registerConfigCommand(program: Command): void {
  const config = program.command("config").description("Manage the global Codex config injection");
  const withHostPort = (command: Command): Command =>
    command
      .option("--host <host>", "gateway host used for the injected base URL", DEFAULT_HOST)
      .option("--port <number>", "gateway port used for the injected base URL", String(DEFAULT_PORT));

  withHostPort(config.command("status"))
    .description("Show the openai_base_url injection state")
    .action(async (options: { host: string; port: string }) => {
      const status = await new CodexConfigService().status(options.host, parsePortOption(options.port) ?? DEFAULT_PORT);
      out("[codex-router] config:");
      out(`  config path     : ${status.configPath}`);
      out(`  gateway base    : ${status.gatewayBaseUrl}`);
      out(`  openai_base_url : ${status.openaiBaseUrl ?? "(not set)"}`);
      out(`  applied         : ${status.applied ? "yes" : "no"}`);
      out(`  model catalog   : ${status.modelCatalogJson ?? "(none)"}`);
      out(`  backup exists   : ${status.hasBackup ? "yes" : "no"}`);
    });

  withHostPort(config.command("apply"))
    .description("Point openai_base_url at the gateway (backup first)")
    .action(async (options: { host: string; port: string }) => {
      try {
        const service = new CodexConfigService();
        const status = await service.applyGatewayConfig(options.host, parsePortOption(options.port) ?? DEFAULT_PORT);
        out("[codex-router] config: applying");
        out(`  backup created  : ${path.join(path.dirname(status.configPath), BACKUP_NAME)}`);
        out(`  openai_base_url : ${status.openaiBaseUrl}`);
        out(`  applied         : ${status.applied ? "yes" : "no"}`);
      } catch (error) {
        err(`[codex-router] config apply failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  withHostPort(config.command("restore"))
    .description("Restore the gateway backup")
    .action(async (options: { host: string; port: string }) => {
      try {
        const status = await new CodexConfigService().restoreGatewayConfig(options.host, parsePortOption(options.port) ?? DEFAULT_PORT);
        out("[codex-router] config: restored from backup");
        out(`  openai_base_url : ${status.openaiBaseUrl ?? "(not set)"}`);
        out(`  applied         : ${status.applied ? "yes" : "no"}`);
      } catch (error) {
        err(`[codex-router] config restore failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}

// --- entry -----------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();
  program.name("codex-router").description("Local transparent identity proxy for the Codex CLI").version(VERSION).showHelpAfterError();

  program
    .command("start", { isDefault: true })
    .description("Start the gateway (defaults to running in the background)")
    .option("-f, --foreground", "run in the foreground and stream logs to the terminal")
    .option("--host <host>", "listen host (127.0.0.1 or ::1)")
    .option("--port <number>", "listen port")
    .option("--data-dir <path>", "data directory (db, accounts, logs)")
    .option("--upstream <url>", "upstream base URL (requires --dev)")
    .option("--dev", "enable developer mode so a custom upstream is allowed")
    .option("--log-level <level>", "pino log level (default: info)")
    .option("--log-file <path>", "log file path for background mode")
    .action(actionStart);

  program
    .command("status")
    .description("Show gateway, config and account status")
    .option("--host <host>", "gateway host", DEFAULT_HOST)
    .option("--port <number>", "gateway port", String(DEFAULT_PORT))
    .option("--data-dir <path>", "data directory")
    .action(actionStatus);

  program
    .command("stop")
    .description("Stop a running gateway")
    .option("--host <host>", "gateway host", DEFAULT_HOST)
    .option("--port <number>", "gateway port", String(DEFAULT_PORT))
    .option("--data-dir <path>", "data directory")
    .action(actionStop);

  program
    .command("logs")
    .description("Show the gateway log file")
    .option("-f, --tail", "follow the log as it grows")
    .option("--data-dir <path>", "data directory")
    .action(actionLogs);

  registerConfigCommand(program);

  return program;
}

async function main(): Promise<void> {
  const program = createProgram();
  await program.parseAsync(process.argv);
}

export function isEntryScript(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try {
    return fileURLToPath(moduleUrl) === realpathSync(argv1);
  } catch {
    return false;
  }
}

const isMainEntry = isEntryScript(process.argv[1], import.meta.url);
if (isMainEntry) {
  main().catch((error) => {
    err(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
