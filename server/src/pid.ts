import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function pidFilePath(dataDir: string): string {
  return path.join(dataDir, "gateway.pid");
}

export async function writePidFile(dataDir: string): Promise<void> {
  await writeFile(pidFilePath(dataDir), `${process.pid}\n`, "utf8");
}

export async function removePidFile(dataDir: string): Promise<void> {
  try {
    await unlink(pidFilePath(dataDir));
  } catch {
    // already gone
  }
}

export async function readPidFile(dataDir: string): Promise<number | null> {
  try {
    const raw = (await readFile(pidFilePath(dataDir), "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
