import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayDatabase } from "../src/db/database.js";
import { CodexUsageService, UNCATEGORIZED_PROJECT_KEY, codexUsageInternals } from "../src/codex/codex-usage-service.js";
import { buildGateway } from "../src/app.js";

const temporary: string[] = [];
const originalCodexHome = process.env.CODEX_HOME;
afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = originalCodexHome;
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; database: GatewayDatabase; service: CodexUsageService; auditPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-test-")); temporary.push(root);
  await mkdir(path.join(root, "sessions", "2026", "08", "20"), { recursive: true });
  await mkdir(path.join(root, "archived_sessions"), { recursive: true });
  process.env.CODEX_HOME = root;
  const database = new GatewayDatabase(path.join(root, "gateway.db"));
  const dataDir = path.join(root, "router");
  const auditPath = path.join(dataDir, "logs", "codex-usage-retention.jsonl");
  const service = await CodexUsageService.create({
    dataDir,
    legacyDb: database.raw,
    onChange: () => undefined,
    log: { warn: () => undefined },
    minimumMissingAgeMs: 0,
    automaticBackups: false,
  });
  return { root, database, service, auditPath };
}

const thread = "019fe159-caca-7b40-8641-bad1fd122cb7";
const row = (timestamp: string, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp, type, payload });
const tokens = (timestamp: string, input: number, cached: number, output: number, reasoning: number, last = { input, cached, output, reasoning }) => row(timestamp, "event_msg", {
  type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning },
    last_token_usage: { input_tokens: last.input, cached_input_tokens: last.cached, output_tokens: last.output, reasoning_output_tokens: last.reasoning } },
});

describe.sequential("CodexUsageService", () => {
  it("groups only Codex date workspaces as uncategorized conversations", () => {
    expect(codexUsageInternals.projectIdentity("C:\\Users\\test\\AppData\\Local\\Temp\\Codex\\2026-08-18\\x")).toEqual({ key: UNCATEGORIZED_PROJECT_KEY, label: "无分类对话" });
    expect(codexUsageInternals.projectIdentity("C:\\Users\\test\\AppData\\Local\\Temp\\Codex\\2026-08-12\\a-different-name")).toEqual({ key: UNCATEGORIZED_PROJECT_KEY, label: "无分类对话" });
    expect(codexUsageInternals.projectIdentity("D:\\projects\\2026-08-18\\x")?.label).toBe("2026-08-18/x");
    expect(codexUsageInternals.projectIdentity("D:\\codespace\\codex-router")?.label).toBe("codespace/codex-router");
  });

  it("keeps uncategorized conversations visible outside the top eight", () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ key: `project-${index}`, label: `Project ${index}`, totalTokens: 100 - index, tasks: 1, share: .09 }));
    rows.push({ key: UNCATEGORIZED_PROJECT_KEY, label: "无分类对话", totalTokens: 1, tasks: 1, share: .01 });
    const limited = codexUsageInternals.limitProjectRows(rows);
    expect(limited.map((row) => row.key)).toContain(UNCATEGORIZED_PROJECT_KEY);
    expect(limited.at(-1)).toMatchObject({ key: "other", totalTokens: 276, tasks: 3, share: .27 });
  });

  it("converts cumulative snapshots to deltas and never exposes the full project path", async () => {
    const { root, database, service } = await fixture();
    const file = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    await writeFile(file, [
      row("2026-08-20T15:59:00.000Z", "session_meta", { id: thread, timestamp: "2026-08-20T15:59:00.000Z", cwd: "D:\\secret\\codex-router" }),
      row("2026-08-20T16:00:00.000Z", "turn_context", { model: "gpt-test", cwd: "D:\\secret\\codex-router" }),
      row("2026-08-20T16:00:01.000Z", "event_msg", { type: "task_started" }),
      tokens("2026-08-20T16:00:02.000Z", 100, 20, 10, 4),
      tokens("2026-08-20T16:00:03.000Z", 160, 50, 20, 6, { input: 60, cached: 30, output: 10, reasoning: 2 }),
      row("2026-08-20T16:00:04.000Z", "event_msg", { type: "task_complete" }),
    ].join("\n") + "\n");
    await service.scan();
    const dashboard = service.getDashboard({ range: "all" }) as any;
    expect(dashboard.summary).toMatchObject({ totalTokens: 180, inputTokens: 160, cachedInputTokens: 50, outputTokens: 20, tasksStarted: 1, tasksCompleted: 1 });
    expect(dashboard.filters.projects[0].label).toBe("secret/codex-router");
    expect(JSON.stringify(dashboard)).not.toContain("D:\\\\secret");
    const persisted = JSON.stringify(service.database.prepare("SELECT * FROM codex_usage_rollout").get());
    expect(persisted).not.toContain("D:\\\\secret");
    await service.close(); database.close();
  });

  it("merges temporary rollouts into one filterable project bucket", async () => {
    const { root, database, service } = await fixture();
    const secondThread = "019fe159-caca-7b40-8641-bad1fd122cb8";
    const directory = path.join(root, "sessions", "2026", "08", "20");
    await writeFile(path.join(directory, `rollout-${thread}.jsonl`), `${row("2026-08-20T16:00:00.000Z", "session_meta", { id: thread, cwd: "C:\\Temp\\Codex\\2026-08-18\\x" })}\n${tokens("2026-08-20T16:00:01.000Z", 10, 2, 3, 1)}\n`);
    await writeFile(path.join(directory, `rollout-${secondThread}.jsonl`), `${row("2026-08-20T17:00:00.000Z", "session_meta", { id: secondThread, cwd: "C:\\Temp\\Codex\\2026-08-19\\another" })}\n${tokens("2026-08-20T17:00:01.000Z", 8, 1, 4, 1)}\n`);
    await service.scan();
    const dashboard = service.getDashboard({ range: "all" }) as any;
    expect(dashboard.filters.projects).toEqual([{ key: UNCATEGORIZED_PROJECT_KEY, label: "无分类对话" }]);
    expect(dashboard.projects).toEqual([expect.objectContaining({ key: UNCATEGORIZED_PROJECT_KEY, label: "无分类对话", totalTokens: 25 })]);
    expect((service.getDashboard({ range: "all", project: UNCATEGORIZED_PROJECT_KEY }) as any).summary.totalTokens).toBe(25);
    await service.close(); database.close();
  });

  it("keeps the heatmap on the whole history whatever the filters select", async () => {
    const { root, database, service } = await fixture();
    const secondThread = "019fe159-caca-7b40-8641-bad1fd122cb8";
    const directory = path.join(root, "sessions", "2026", "08", "20");
    await writeFile(path.join(directory, `rollout-${thread}.jsonl`), `${row("2026-08-20T16:00:00.000Z", "session_meta", { id: thread, cwd: "D:\a" })}
${row("2026-08-20T16:00:00.500Z", "turn_context", { model: "gpt-one", cwd: "D:\a" })}
${tokens("2026-08-20T16:00:01.000Z", 10, 2, 3, 1)}
`);
    await writeFile(path.join(directory, `rollout-${secondThread}.jsonl`), `${row("2026-08-22T17:00:00.000Z", "session_meta", { id: secondThread, cwd: "D:\b" })}
${row("2026-08-22T17:00:00.500Z", "turn_context", { model: "gpt-two", cwd: "D:\b" })}
${tokens("2026-08-22T17:00:01.000Z", 8, 1, 4, 1)}
`);
    await service.scan();

    const total = (dashboard: any) => dashboard.heatmap.reduce((sum: number, cell: any) => sum + cell.totalTokens, 0);
    const unfiltered = service.getDashboard({ range: "all" }) as any;
    // The summary narrows with the filter; the rhythm the heatmap describes
    // belongs to the whole history and must not.
    const narrowed = service.getDashboard({ range: "all", model: "gpt-one" }) as any;
    expect(narrowed.summary.totalTokens).toBeLessThan(unfiltered.summary.totalTokens);
    expect(total(narrowed)).toBe(total(unfiltered));
    expect(narrowed.heatmap).toEqual(unfiltered.heatmap);
    const firstDay = unfiltered.heatmap.filter((cell: any) => cell.date === "2026-08-21");
    const emptyDay = unfiltered.heatmap.filter((cell: any) => cell.date === "2026-08-22");
    const lastDay = unfiltered.heatmap.filter((cell: any) => cell.date === "2026-08-23");
    expect(firstDay).toHaveLength(24);
    expect(firstDay.reduce((sum: number, cell: any) => sum + cell.totalTokens, 0)).toBe(13);
    expect(emptyDay).toHaveLength(24);
    expect(emptyDay.every((cell: any) => cell.totalTokens === 0)).toBe(true);
    expect(lastDay.reduce((sum: number, cell: any) => sum + cell.totalTokens, 0)).toBe(12);
    await service.close(); database.close();
  });

  it("keeps an incomplete trailing line for the next incremental scan", async () => {
    const { root, database, service } = await fixture();
    const file = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    const first = tokens("2026-08-20T16:00:00.000Z", 10, 2, 3, 1);
    const second = tokens("2026-08-20T16:01:00.000Z", 20, 4, 5, 2, { input: 10, cached: 2, output: 2, reasoning: 1 });
    await writeFile(file, `${first}\n${second.slice(0, -5)}`);
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(13);
    await writeFile(file, `${first}\n${second}\n`);
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(25);
    await service.close(); database.close();
  });

  it("reads compressed rollouts and permanently retains statistics when their source disappears", async () => {
    const { root, database, service, auditPath } = await fixture();
    const file = path.join(root, "archived_sessions", `rollout-${thread}.jsonl.zst`);
    await writeFile(file, zstdCompressSync(Buffer.from(`${tokens("2026-08-20T16:00:00.000Z", 12, 4, 3, 1)}\n`)));
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(15);
    await rm(file);
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).coverage.scan.pendingMissingRollouts).toBe(1);
    await service.scan();
    const retained = service.getDashboard({ range: "all" }) as any;
    expect(retained.summary.totalTokens).toBe(15);
    expect(retained.coverage).toMatchObject({ sourceRollouts: 0, retainedRollouts: 1, rollouts: 1 });
    expect((service.database.prepare("SELECT COUNT(*) AS count FROM codex_usage_retained_event").get() as { count: number }).count).toBe(1);
    const audit = await readFile(auditPath, "utf8");
    expect(audit).toContain('"event":"baseline"');
    expect(audit).toContain('"event":"source_missing"');
    expect(audit).not.toContain(thread);
    expect(audit).not.toContain(root);
    await writeFile(file, zstdCompressSync(Buffer.from(`${tokens("2026-08-20T16:00:00.000Z", 12, 4, 3, 1)}\n`)));
    await service.scan();
    const restored = service.getDashboard({ range: "all" }) as any;
    expect(restored.summary.totalTokens).toBe(15);
    expect(restored.coverage).toMatchObject({ sourceRollouts: 1, retainedRollouts: 0, rollouts: 1 });
    expect(await readFile(auditPath, "utf8")).toContain('"event":"source_restored"');
    await service.close(); database.close();
  });

  it("cancels a pending missing candidate when the rollout reappears", async () => {
    const { root, database, service, auditPath } = await fixture();
    const file = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    const content = `${tokens("2026-08-20T16:00:00.000Z", 10, 2, 3, 1)}\n`;
    await writeFile(file, content); await service.scan(); await rm(file); await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).coverage.scan.pendingMissingRollouts).toBe(1);
    await writeFile(file, content); await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).coverage).toMatchObject({ sourceRollouts: 1, retainedRollouts: 0 });
    expect(await readFile(auditPath, "utf8")).not.toContain('"event":"source_missing"');
    await service.close(); database.close();
  });

  it("prefers active plain rollouts over archived compressed copies", async () => {
    const { root, database, service } = await fixture();
    const plain = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    const compressed = path.join(root, "archived_sessions", `rollout-${thread}.jsonl.zst`);
    await writeFile(plain, `${tokens("2026-08-20T16:00:00.000Z", 10, 2, 3, 1)}\n`);
    await writeFile(compressed, zstdCompressSync(Buffer.from(`${tokens("2026-08-20T16:00:00.000Z", 100, 20, 30, 10)}\n`)));
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(13);
    await service.close(); database.close();
  });

  it("keeps the last valid derived data when a rewritten rollout is malformed", async () => {
    const { root, database, service } = await fixture();
    const file = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    await writeFile(file, `${tokens("2026-08-20T16:00:00.000Z", 10, 2, 3, 1)}\n`); await service.scan();
    await writeFile(file, '{"timestamp":"2026-08-20T16:00:00.000Z","type":"event_msg",broken}\n'); await service.scan();
    const dashboard = service.getDashboard({ range: "all" }) as any;
    expect(dashboard.summary.totalTokens).toBe(13); expect(dashboard.status).toBe("partial");
    await service.close(); database.close();
  });

  it("truncates uncovered dates and aggregates daily model usage independently of the model filter", async () => {
    const { root, database, service } = await fixture();
    const file = path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`);
    await writeFile(file, [
      row("2026-08-20T16:00:00.000Z", "session_meta", { id: thread, timestamp: "2026-08-20T16:00:00.000Z", cwd: "D:\\codespace\\codex-router" }),
      row("2026-08-20T16:00:01.000Z", "turn_context", { model: "gpt-a", cwd: "D:\\codespace\\codex-router" }),
      tokens("2026-08-20T16:00:02.000Z", 10, 2, 2, 1),
      row("2026-08-20T16:00:03.000Z", "turn_context", { model: "gpt-b", cwd: "D:\\codespace\\codex-router" }),
      tokens("2026-08-20T16:00:04.000Z", 20, 4, 5, 2, { input: 10, cached: 2, output: 3, reasoning: 1 }),
    ].join("\n") + "\n");
    await service.scan();
    const dashboard = service.getDashboard({ range: "90d", model: "gpt-a" }) as any;
    expect(dashboard.daily[0].date).toBe("2026-08-21");
    expect(dashboard.summary.totalTokens).toBe(12);
    expect(dashboard.dailyModels).toEqual(expect.arrayContaining([expect.objectContaining({ totalTokens: 25, models: [
      expect.objectContaining({ key: "gpt-b", totalTokens: 13 }),
      expect.objectContaining({ key: "gpt-a", totalTokens: 12 }),
    ] })]));
    await service.close(); database.close();
  });

  it("retains previous sources without mixing them when CODEX_HOME changes", async () => {
    const { root, database, service, auditPath } = await fixture();
    await writeFile(path.join(root, "sessions", "2026", "08", "20", `rollout-${thread}.jsonl`), `${tokens("2026-08-20T16:00:00.000Z", 10, 2, 2, 1)}\n`);
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(12);

    const nextRoot = await mkdtemp(path.join(os.tmpdir(), "codex-usage-source-test-")); temporary.push(nextRoot);
    await mkdir(path.join(nextRoot, "sessions"), { recursive: true }); await mkdir(path.join(nextRoot, "archived_sessions"), { recursive: true });
    const nextThread = "019fe159-caca-7b40-8641-bad1fd122cb9";
    await writeFile(path.join(nextRoot, "sessions", `rollout-${nextThread}.jsonl`), `${tokens("2026-08-20T17:00:00.000Z", 20, 4, 3, 1)}\n`);
    process.env.CODEX_HOME = nextRoot;
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(23);
    expect((service.database.prepare("SELECT COUNT(DISTINCT source_hash) AS count FROM codex_usage_retained_rollout").get() as { count: number }).count).toBe(1);

    process.env.CODEX_HOME = root;
    await service.scan();
    expect((service.getDashboard({ range: "all" }) as any).summary.totalTokens).toBe(12);
    const audit = await readFile(auditPath, "utf8");
    expect(audit.match(/"event":"source_changed"/g)).toHaveLength(2);
    expect(audit).not.toContain(thread);
    expect(audit).not.toContain(nextThread);
    await service.close(); database.close();
  });

  it("serves validated dashboard filters through the read-only admin API", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-api-test-")); temporary.push(root);
    await mkdir(path.join(root, "sessions"), { recursive: true }); await mkdir(path.join(root, "archived_sessions"), { recursive: true });
    process.env.CODEX_HOME = root;
    await writeFile(path.join(root, "sessions", `rollout-${thread}.jsonl`), `${tokens("2026-08-20T16:00:00.000Z", 12, 4, 3, 1)}\n`);
    const gateway = await buildGateway({ dataDir: path.join(root, "router"), webDistDir: path.join(root, "missing-web"), developerMode: true });
    await gateway.codexUsage.scan();
    const response = await gateway.app.inject({ method: "GET", url: "/api/codex-usage?range=14d" });
    expect(response.statusCode).toBe(200); expect(response.json().summary.totalTokens).toBe(15);
    expect(JSON.stringify(response.json())).not.toContain(root);
    expect((await gateway.app.inject({ method: "GET", url: "/api/codex-usage?range=bad" })).statusCode).toBe(400);
    await gateway.app.close();
  });

  it("purges derived usage rows when upgrading the project classifier", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-migration-test-")); temporary.push(root);
    const databasePath = path.join(root, "gateway.db");
    const legacy = new GatewayDatabase(databasePath);
    legacy.raw.prepare("INSERT INTO codex_usage_rollout(thread_id,source_hash,relative_path,encoding,file_size,mtime_ms,last_scanned_at) VALUES (?,?,?,?,?,?,?)").run(thread, "source", "sessions/rollout.jsonl", "jsonl", 1, 1, 1);
    legacy.raw.prepare("DELETE FROM schema_migrations").run();
    legacy.raw.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES (13,?)").run(Date.now());
    legacy.close();
    const migrated = new GatewayDatabase(databasePath);
    expect((migrated.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_rollout").get() as { count: number }).count).toBe(0);
    expect((migrated.raw.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(17);
    expect((migrated.raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'codex_usage_retained_%'").get() as { count: number }).count).toBe(2);
    migrated.close();
  });
});
