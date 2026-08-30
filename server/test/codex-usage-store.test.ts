import { appendFile, mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexUsageStore } from "../src/codex/codex-usage-store.js";
import { GatewayDatabase } from "../src/db/database.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-store-test-")); temporary.push(root);
  const legacy = new GatewayDatabase(path.join(root, "gateway.db"));
  const warnings: string[] = [];
  const log = { warn: (_values: Record<string, unknown>, message: string) => warnings.push(message) };
  const store = await CodexUsageStore.open(path.join(root, "router"), legacy.raw, log);
  return { root, legacy, log, store, warnings };
}

describe.sequential("CodexUsageStore", () => {
  it("backs up migrations and clears active derivations that need rescanning", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-usage-migrate-test-")); temporary.push(root);
    const legacy = new GatewayDatabase(path.join(root, "gateway.db"));
    const source = "legacy-source"; const thread = "019fe159-caca-7b40-8641-bad1fd122cb7";
    legacy.raw.prepare("INSERT INTO codex_usage_rollout(thread_id,source_hash,relative_path,encoding,file_size,mtime_ms,last_scanned_at) VALUES (?,?,?,?,?,?,?)").run(thread, source, "sessions/rollout.jsonl", "jsonl", 10, 1, 1);
    legacy.raw.prepare("INSERT INTO codex_usage_event(thread_id,ordinal,occurred_at,kind,total_tokens) VALUES (?,?,?,?,?)").run(thread, 0, 1, "tokens", 42);
    const dataDir = path.join(root, "router");
    const store = await CodexUsageStore.open(dataDir, legacy.raw, { warn: () => undefined });
    const migrated = store.raw.prepare("SELECT thread_id,source_hash,source_category FROM codex_usage_rollout").get() as Record<string, unknown>;
    expect(migrated).toMatchObject({ source_category: "sessions" });
    expect(migrated.thread_id).not.toBe(thread); expect(migrated.source_hash).not.toBe(source);
    expect((store.raw.prepare("SELECT SUM(total_tokens) AS total FROM codex_usage_event").get() as { total: number }).total).toBe(42);
    store.setMeta("schema_version", "1");
    await store.close();
    const reopened = await CodexUsageStore.open(dataDir, legacy.raw, { warn: () => undefined });
    expect((reopened.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_event").get() as { count: number }).count).toBe(0);
    expect((reopened.raw.prepare("SELECT value FROM usage_meta WHERE key='schema_version'").get() as { value: string }).value).toBe("3");
    expect((await readdir(reopened.backupDir)).some((name) => name.startsWith("codex-usage-pre-migration-") && name.endsWith(".manifest.json"))).toBe(true);
    await reopened.close(); legacy.close();
  });

  it("repairs an incomplete audit tail and rebuilds a tampered hash chain", async () => {
    const { root, legacy, store, log } = await fixture();
    store.transaction(() => store.recordAudit("baseline", { sourceHash: "safe-hash", rolloutCount: 0, inventoryDigest: "digest" }));
    await store.flushAudit(); const auditPath = store.auditPath; await store.close();
    await appendFile(auditPath, "{incomplete");
    const reopened = await CodexUsageStore.open(path.join(root, "router"), legacy.raw, log);
    const repaired = await readFile(auditPath, "utf8");
    expect(repaired.endsWith("\n")).toBe(true); expect(repaired).not.toContain("incomplete");
    await reopened.close();
    const line = JSON.parse(repaired.trim()) as Record<string, unknown>; line.eventHash = "0".repeat(64);
    await writeFile(auditPath, `${JSON.stringify(line)}\n`);
    const rebuilt = await CodexUsageStore.open(path.join(root, "router"), legacy.raw, log);
    const rebuiltLine = JSON.parse((await readFile(auditPath, "utf8")).trim()) as Record<string, unknown>;
    expect(rebuiltLine.eventHash).not.toBe(line.eventHash);
    expect((await readdir(path.dirname(auditPath))).some((name) => name.startsWith("codex-usage-retention.jsonl.corrupt-"))).toBe(true);
    await rebuilt.close(); legacy.close();
  });

  it("creates verified online snapshots and restores from the newest valid generation", async () => {
    const { root, legacy, store, log } = await fixture();
    store.raw.prepare("INSERT INTO codex_usage_source VALUES (?,?,?,NULL,0,0)").run("source", null, Date.now());
    store.raw.prepare("INSERT INTO codex_usage_rollout(thread_id,source_hash,source_category,encoding,file_size,mtime_ms,last_scanned_at) VALUES (?,?,?,?,?,?,?)").run("thread", "source", "sessions", "jsonl", 1, 1, 1);
    store.raw.prepare("INSERT INTO codex_usage_event(thread_id,ordinal,occurred_at,kind,total_tokens) VALUES (?,?,?,?,?)").run("thread", 0, 1, "tokens", 73);
    await store.createBackup("daily");
    expect(store.status().backup).toMatchObject({ status: "ready", generations: 1 });
    const databasePath = store.databasePath; await store.close(); await unlink(databasePath);
    const recovered = await CodexUsageStore.open(path.join(root, "router"), legacy.raw, log);
    expect((recovered.raw.prepare("SELECT SUM(total_tokens) AS total FROM codex_usage_event").get() as { total: number }).total).toBe(73);
    expect(recovered.status().backup.lastRecoveryAt).not.toBeNull();
    expect((recovered.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_audit_event WHERE event='database_recovered'").get() as { count: number }).count).toBe(1);
    await recovered.close(); legacy.close();
  });
});
