import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexConfigService } from "../src/codex/codex-config.js";

const temporary: string[] = [];
async function tempHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "codex-config-test-"));
  temporary.push(home);
  return home;
}

afterEach(() => {
  vi.unstubAllEnvs();
  return Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SAMPLE = `model = "gpt-5.6-luna"
service_tier = "default"

notify = [ "C:\\\\node_modules\\\\codex.exe", "turn-ended" ]
model_catalog_json = "C:\\\\Users\\\\me\\\\.codex\\\\opencodex-catalog.json"
# Auto-injected by opencodex
openai_base_url = "http://127.0.0.1:10100/v1"

[marketplaces.openai-bundled]
last_updated = "2026-08-08T07:36:27Z"
source_type = "local"
source = '\\\\?\\C:\\Users\\me\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled'

[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
`;

const SAMPLE_TABLE_END = `model = "gpt-5.6-luna"

[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
`;

async function parseRoot(home: string): Promise<Record<string, unknown>> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const script = `import tomllib; d=tomllib.load(open(${JSON.stringify(path.join(home, "config.toml"))},"rb")); print(d.get("openai_base_url")); print(d.get("model_catalog_json"))`;
  const { stdout } = await execFileAsync("python", ["-c", script]);
  const [openaiBaseUrl, modelCatalogJson] = stdout.trim().split("\n");
  const clean = (value: string) => value.trim();
  return { openaiBaseUrl: openaiBaseUrl === "None" ? null : clean(openaiBaseUrl), modelCatalogJson: modelCatalogJson === "None" ? null : clean(modelCatalogJson) };
}

describe("CodexConfigService", () => {
  it("reports current openai_base_url and applied state", async () => {
    const home = await tempHome();
    await writeFile(path.join(home, "config.toml"), SAMPLE);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const status = await service.status("127.0.0.1", 8317);
    expect(status.openaiBaseUrl).toBe("http://127.0.0.1:10100/v1");
    expect(status.gatewayBaseUrl).toBe("http://127.0.0.1:8317/backend-api/codex");
    expect(status.applied).toBe(false);
    expect(status.configExists).toBe(true);
    expect(status.hasBackup).toBe(false);
    expect(status.modelCatalogJson).toBe("C:\\Users\\me\\.codex\\opencodex-catalog.json");
  });

  it("replaces openai_base_url at the TOML root and strips the opencodex catalog", async () => {
    const home = await tempHome();
    await writeFile(path.join(home, "config.toml"), SAMPLE);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const status = await service.applyGatewayConfig("127.0.0.1", 8317);
    expect(status.applied).toBe(true);
    expect(status.openaiBaseUrl).toBe("http://127.0.0.1:8317/backend-api/codex");
    expect(status.modelCatalogJson).toBeNull();
    const root = await parseRoot(home);
    expect(root.openaiBaseUrl).toBe("http://127.0.0.1:8317/backend-api/codex");
    expect(root.modelCatalogJson).toBeNull();
    const content = await readFile(path.join(home, "config.toml"), "utf8");
    expect(content).toContain('model = "gpt-5.6-luna"');
    expect(content).toContain("[marketplaces.openai-bundled]");
    expect(content).not.toContain("10100");
    expect(content).not.toContain("opencodex-catalog.json");
    expect(status.hasBackup).toBe(true);
    const backup = await readFile(path.join(home, "config.toml.gateway.bak"), "utf8");
    expect(backup).toContain("10100");
  });

  it("strips a legacy codex-gateway marker and never duplicates markers on re-apply", async () => {
    const home = await tempHome();
    const legacy = '# Auto-injected by codex-gateway\nopenai_base_url = "http://127.0.0.1:9999/backend-api/codex"\n\nmodel = "gpt-5.6-luna"\n';
    await writeFile(path.join(home, "config.toml"), legacy);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const status = await service.applyGatewayConfig("127.0.0.1", 8317);
    expect(status.applied).toBe(true);
    const content = await readFile(path.join(home, "config.toml"), "utf8");
    expect(content).not.toContain("codex-gateway");
    expect(content.match(/# Auto-injected by codex-router/g)).toHaveLength(1);
    expect(content.match(/openai_base_url\s*=\s*"[^"]*"/g)).toHaveLength(1);
    expect(content).toContain("http://127.0.0.1:8317/backend-api/codex");
  });

  it("appends openai_base_url at the root even when the file ends with a table", async () => {
    const home = await tempHome();
    await writeFile(path.join(home, "config.toml"), SAMPLE_TABLE_END);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const applied = await service.applyGatewayConfig("127.0.0.1", 8317);
    expect(applied.applied).toBe(true);
    const root = await parseRoot(home);
    expect(root.openaiBaseUrl).toBe("http://127.0.0.1:8317/backend-api/codex");
    expect(root.modelCatalogJson).toBeNull();
    const content = await readFile(path.join(home, "config.toml"), "utf8");
    expect(content).toContain("[mcp_servers.shadcn]");
    expect(content.match(/openai_base_url\s*=\s*"[^"]*"/g)).toHaveLength(1);
  });

  it("does not treat a table-scoped openai_base_url as applied", async () => {
    const home = await tempHome();
    const bad = `${SAMPLE_TABLE_END}\nopenai_base_url = "http://127.0.0.1:9999/backend-api/codex"\n`;
    await writeFile(path.join(home, "config.toml"), bad);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const status = await service.status("127.0.0.1", 8317);
    expect(status.openaiBaseUrl).toBeNull();
    expect(status.applied).toBe(false);
  });

  it("restores from backup and returns the original values", async () => {
    const home = await tempHome();
    await writeFile(path.join(home, "config.toml"), SAMPLE);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    const applied = await service.applyGatewayConfig("127.0.0.1", 8317);
    expect(applied.applied).toBe(true);
    const restored = await service.restoreGatewayConfig("127.0.0.1", 8317);
    expect(restored.applied).toBe(false);
    expect(restored.openaiBaseUrl).toBe("http://127.0.0.1:10100/v1");
    expect(restored.modelCatalogJson).toBe("C:\\Users\\me\\.codex\\opencodex-catalog.json");
    const root = await parseRoot(home);
    expect(root.openaiBaseUrl).toBe("http://127.0.0.1:10100/v1");
    expect(root.modelCatalogJson).toBe("C:\\Users\\me\\.codex\\opencodex-catalog.json");
  });

  it("throws when the config file is missing", async () => {
    const home = await tempHome();
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    await expect(service.applyGatewayConfig("127.0.0.1", 8317)).rejects.toThrow("codex_config_not_found");
  });

  it("restore fails when no backup exists", async () => {
    const home = await tempHome();
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "config.toml"), SAMPLE);
    vi.stubEnv("CODEX_HOME", home);
    const service = new CodexConfigService();
    await expect(service.restoreGatewayConfig("127.0.0.1", 8317)).rejects.toThrow("codex_config_backup_missing");
  });
});
