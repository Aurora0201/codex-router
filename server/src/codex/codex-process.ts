import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { codexConfigPath } from "./codex-config.js";

const execFileAsync = promisify(execFile);

export interface CodexProcessStatus {
  running: boolean;
  codexPath: string | null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function detectCodexPath(): Promise<string | null> {
  const configPath = codexConfigPath();
  if (await exists(configPath)) {
    const content = await readFile(configPath, "utf8");
    const match = content.match(/^CODEX_CLI_PATH\s*=\s*'([^']+)'/m)
      ?? content.match(/CODEX_CLI_PATH\s*=\s*['"]([^'"]+)['"]/m);
    if (match) {
      const candidate = match[1];
      if (await exists(candidate)) return candidate;
    }
  }

  const searchRoot = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "OpenAI", "Codex", "bin");
  for (const entry of await readDirSafe(searchRoot)) {
    const candidate = path.join(searchRoot, entry, "codex.exe");
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function codexRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq codex.exe", "/NH"]);
      return stdout.includes("codex.exe");
    }
    const { stdout } = await execFileAsync("pgrep", ["-x", "codex"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function restartCodex(): Promise<CodexProcessStatus> {
  const codexPath = await detectCodexPath();
  if (!codexPath) throw new Error("codex_executable_not_found");
  await killCodex();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await spawnCodex(codexPath);
  return { running: true, codexPath };
}

async function killCodex(): Promise<void> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/IM", "codex.exe", "/F"]).catch(() => undefined);
    } else {
      await execFileAsync("pkill", ["-x", "codex"]).catch(() => undefined);
    }
  } catch {
    // No matching process is fine.
  }
}

async function spawnCodex(codexPath: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const child = spawn(codexPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}
