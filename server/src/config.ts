import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { GatewayConfig } from "./types.js";

const OFFICIAL_UPSTREAM = "https://chatgpt.com/backend-api/codex";
const require = createRequire(import.meta.url);

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "8317");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("GATEWAY_PORT must be an integer between 1 and 65535");
  }
  return port;
}

export function loadConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const developerMode =
    overrides.developerMode ?? (process.env.GATEWAY_DEVELOPER_MODE === "true" || process.env.NODE_ENV === "test");
  const host = (overrides.host ?? process.env.GATEWAY_HOST ?? "127.0.0.1") as GatewayConfig["host"];
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Codex Router only listens on loopback (127.0.0.1 or ::1)");
  }

  const upstreamBaseUrl = (overrides.upstreamBaseUrl ?? process.env.GATEWAY_UPSTREAM ?? OFFICIAL_UPSTREAM).replace(/\/$/, "");
  if (!developerMode && upstreamBaseUrl !== OFFICIAL_UPSTREAM) {
    throw new Error("A custom upstream requires GATEWAY_DEVELOPER_MODE=true");
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dataDir = path.resolve(overrides.dataDir ?? process.env.GATEWAY_DATA_DIR ?? path.join(root, "data"));
  const accountsDir = path.resolve(overrides.accountsDir ?? path.join(dataDir, "accounts"));
  const loginStagingDir = path.resolve(overrides.loginStagingDir ?? path.join(dataDir, "login-staging"));
  const cliOverride = overrides.codexCliPath ?? process.env.CODEX_ROUTER_CLI;
  const bundledCodex = require.resolve("@openai/codex/bin/codex.js");

  return {
    host,
    port: overrides.port ?? parsePort(process.env.GATEWAY_PORT),
    upstreamBaseUrl,
    dataDir,
    accountsDir,
    loginStagingDir,
    databasePath: path.resolve(overrides.databasePath ?? path.join(dataDir, "gateway.db")),
    webDistDir: path.resolve(overrides.webDistDir ?? process.env.GATEWAY_WEB_DIST ?? path.join(root, "web", "dist")),
    webV2DistDir: path.resolve(
      overrides.webV2DistDir ?? process.env.GATEWAY_WEB_V2_DIST ?? path.join(root, "web-v2", "dist"),
    ),
    codexCliPath: cliOverride ?? process.execPath,
    codexCliArgs: overrides.codexCliArgs ?? (cliOverride ? ["app-server"] : [bundledCodex, "app-server"]),
    requestBodyLimit: overrides.requestBodyLimit ?? 32 * 1024 * 1024,
    developerMode,
  };
}
