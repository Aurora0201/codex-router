import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = 1;
const FILE_NAME = "gateway-start.json";
const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
const FIELDS = new Set(["version", "host", "port", "dataDir", "upstream", "dev", "logLevel", "logFile"]);

export interface LaunchMetadata {
  version: 1;
  host: "127.0.0.1" | "::1";
  port: number;
  dataDir: string;
  upstream: string;
  dev: boolean;
  logLevel?: string;
  logFile: string;
}

export function launchMetadataPath(dataDir: string): string {
  return path.join(dataDir, FILE_NAME);
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function parseLaunchMetadata(value: unknown): LaunchMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !FIELDS.has(key))) return null;
  if (item.version !== VERSION) return null;
  if (item.host !== "127.0.0.1" && item.host !== "::1") return null;
  if (!Number.isInteger(item.port) || (item.port as number) < 1 || (item.port as number) > 65535) return null;
  if (typeof item.dataDir !== "string" || !path.isAbsolute(item.dataDir)) return null;
  if (typeof item.upstream !== "string" || !isSafeUrl(item.upstream)) return null;
  if (typeof item.dev !== "boolean") return null;
  if (item.logLevel !== undefined && (typeof item.logLevel !== "string" || !LOG_LEVELS.has(item.logLevel))) return null;
  if (typeof item.logFile !== "string" || !path.isAbsolute(item.logFile)) return null;
  return item as unknown as LaunchMetadata;
}

export async function readLaunchMetadata(dataDir: string): Promise<LaunchMetadata | null> {
  try {
    return parseLaunchMetadata(JSON.parse(await readFile(launchMetadataPath(dataDir), "utf8")));
  } catch {
    return null;
  }
}

export async function writeLaunchMetadata(dataDir: string, metadata: LaunchMetadata): Promise<void> {
  const target = launchMetadataPath(dataDir);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}
