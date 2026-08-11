import { EventEmitter } from "node:events";
import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import { GATEWAY_VERSION } from "../version.js";

interface JsonRpcResponse {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  params?: unknown;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number | string, PendingCall>();
  constructor(
    private readonly codexCliPath: string,
    readonly codexHome: string,
    private readonly codexArgs: string[] = ["app-server"],
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.codexCliPath, this.codexArgs, {
      env: { ...process.env, CODEX_HOME: this.codexHome },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    const exited = new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        reject(new Error(`codex_app_server_exited:${code ?? signal ?? "unknown"}`));
      });
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.resume();
    child.once("exit", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("codex_app_server_closed"));
      }
      this.pending.clear();
      this.child = null;
    });

    await Promise.race([
      this.call("initialize", {
        clientInfo: { name: "codex-router", title: "Codex Router", version: GATEWAY_VERSION },
        capabilities: { experimentalApi: true },
      }, 15_000),
      exited,
    ]);
    this.notify("initialized", {});
  }

  call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    const child = this.child;
    if (!child) return Promise.reject(new Error("codex_app_server_not_started"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex_app_server_timeout:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = once(child, "exit").then(() => undefined).catch(() => undefined);
    // EOF on stdin is the app-server's graceful-shutdown trigger (stdio mode).
    // It drains background work, shuts down per-thread children and closes
    // SQLite before exiting; on Windows those handles must be released before
    // the CODEX_HOME directory can be renamed, so we wait for the real exit
    // rather than racing a fixed timeout.
    child.stdin.end();
    const graceful = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 30_000)),
    ]);
    if (!graceful) {
      await forceKillProcessTree(child);
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`codex_app_server_rpc:${message.error.code ?? "error"}:${message.error.message ?? "unknown"}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit("notification", message.method, message.params);
  }
}

async function forceKillProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (typeof child.pid !== "number") return;
  if (process.platform === "win32") {
    try {
      await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      return;
    } catch {
      // Fall through to a plain kill if the tree kill is unavailable.
    }
  }
  if (!child.killed) child.kill();
}

export interface AppServerClientFactoryOptions {
  codexCliPath: string;
  codexCliArgs: string[];
}

export async function withAppServerClient<T>(
  options: AppServerClientFactoryOptions,
  codexHome: string,
  operation: (client: AppServerClient) => Promise<T>,
): Promise<T> {
  const client = new AppServerClient(options.codexCliPath, codexHome, options.codexCliArgs);
  try {
    await client.start();
    return await operation(client);
  } finally {
    await client.close();
  }
}
