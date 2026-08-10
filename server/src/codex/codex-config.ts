import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const BACKUP_NAME = "config.toml.gateway.bak";
const GATEWAY_MARKER = "# Auto-injected by codex-router";
const LEGACY_GATEWAY_MARKER = "# Auto-injected by codex-gateway";
const OPENCODEX_MARKER = "# Auto-injected by opencodex";

function codexHomeDir(): string {
  return process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
}

export function codexConfigPath(): string {
  return path.join(codexHomeDir(), "config.toml");
}

function gatewayBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}/backend-api/codex`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Everything before the first `[table]` (or `[[array-of-tables]]`) header is the
// TOML root section. Only keys there are global `openai_base_url` / `model_catalog_json`.
function rootSection(content: string): string {
  const tableStart = content.search(/^\s*\[/m);
  return tableStart === -1 ? content : content.slice(0, tableStart);
}

function rootKey(content: string, key: string): string | null {
  const match = rootSection(content).match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"));
  return match ? unescapeToml(match[1]) : null;
}

function unescapeToml(value: string): string {
  return value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

const GATEWAY_INJECTION = `\n${GATEWAY_MARKER}\nopenai_base_url = "`;
const CATALOG_PATTERN = /^# Auto-injected by opencodex\s*$\n?|^model_catalog_json\s*=\s*"[^"]*"\s*$/m;

function stripOpenCodexCatalog(content: string): string {
  return content
    .replace(CATALOG_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

function injectRootKey(content: string, line: string): string {
  const tableStart = content.search(/^\s*\[/m);
  if (tableStart === -1) {
    return `${content.replace(/\s+$/, "")}\n\n${line}\n`;
  }
  const before = content.slice(0, tableStart).replace(/\s+$/, "");
  const after = content.slice(tableStart);
  return `${before}\n\n${line}\n\n${after}`;
}

export interface CodexConfigStatus {
  configPath: string;
  backupPath: string;
  openaiBaseUrl: string | null;
  gatewayBaseUrl: string;
  applied: boolean;
  modelCatalogJson: string | null;
  hasBackup: boolean;
  configExists: boolean;
}

export class CodexConfigService {
  async status(host: string, port: number): Promise<CodexConfigStatus> {
    const configPath = codexConfigPath();
    const gatewayUrl = gatewayBaseUrl(host, port);
    const configExists = await exists(configPath);
    const content = configExists ? await readFile(configPath, "utf8") : "";
    return {
      configPath,
      backupPath: path.join(path.dirname(configPath), BACKUP_NAME),
      openaiBaseUrl: rootKey(content, "openai_base_url"),
      gatewayBaseUrl: gatewayUrl,
      applied: rootKey(content, "openai_base_url") === gatewayUrl,
      modelCatalogJson: rootKey(content, "model_catalog_json"),
      hasBackup: await exists(path.join(path.dirname(configPath), BACKUP_NAME)),
      configExists,
    };
  }

  async applyGatewayConfig(host: string, port: number): Promise<CodexConfigStatus> {
    const configPath = codexConfigPath();
    if (!(await exists(configPath))) throw new Error("codex_config_not_found");
    const backupPath = path.join(path.dirname(configPath), BACKUP_NAME);
    if (!(await exists(backupPath))) await copyFile(configPath, backupPath);

    const gatewayUrl = gatewayBaseUrl(host, port);
    const original = await readFile(configPath, "utf8");

    // Remove any stale gateway injection first so the final config stays clean.
    // The legacy marker is stripped too so configs injected before the rename
    // do not accumulate a duplicate marker on the next apply.
    let content = original.replace(new RegExp(`^${GATEWAY_MARKER}\\s*\\r?\\n?`, "m"), "");
    content = content.replace(new RegExp(`^${LEGACY_GATEWAY_MARKER}\\s*\\r?\\n?`, "m"), "");
    content = content.replace(/^openai_base_url\s*=\s*"[^"]*"\s*$/m, "");

    // TOML tables can swallow bare root keys that follow them; strip the
    // opencodex catalog reference so the model catalog comes from the gateway.
    content = stripOpenCodexCatalog(content);

    if (rootKey(content, "openai_base_url")) {
      content = content.replace(new RegExp(`^openai_base_url\\s*=\\s*"[^"]*"`, "m"), `openai_base_url = "${gatewayUrl}"`);
    } else {
      content = injectRootKey(content, `${GATEWAY_MARKER}\nopenai_base_url = "${gatewayUrl}"`);
    }

    await writeFile(configPath, `${content}\n`, "utf8");
    return this.status(host, port);
  }

  async restoreGatewayConfig(host: string, port: number): Promise<CodexConfigStatus> {
    const configPath = codexConfigPath();
    const backupPath = path.join(path.dirname(configPath), BACKUP_NAME);
    if (!(await exists(backupPath))) throw new Error("codex_config_backup_missing");
    await copyFile(backupPath, configPath);
    return this.status(host, port);
  }
}

export { gatewayBaseUrl };
