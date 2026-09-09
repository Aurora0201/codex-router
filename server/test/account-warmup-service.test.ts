import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { AccountStatusService } from "../src/accounts/account-status-service.js"
import { AccountWarmupService, shortWindowRunning } from "../src/accounts/account-warmup-service.js"
import { loadConfig } from "../src/config.js"
import { GatewayDatabase } from "../src/db/database.js"

const roots: string[] = []
const services: AccountStatusService[] = []
const databases: GatewayDatabase[] = []

/** `count` ready accounts, each with its own CODEX_HOME the fake server drives. */
async function fixture(count = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), "warmup-test-"))
  roots.push(root)
  const config = loadConfig({
    dataDir: path.join(root, "data"),
    databasePath: path.join(root, "gateway.db"),
    accountsDir: path.join(root, "accounts"),
    loginStagingDir: path.join(root, "staging"),
    codexCliPath: process.execPath,
    codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
    developerMode: true,
  })
  const database = new GatewayDatabase(config.databasePath)
  databases.push(database)
  const homes: string[] = []
  for (let i = 0; i < count; i += 1) {
    const id = `account-${i + 1}`
    const home = path.join(root, id)
    await mkdir(home, { recursive: true })
    await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "a", account_id: id, refresh_token: "r" } }))
    database.accounts.insert({ id, codexHome: home })
    database.accounts.update(id, { authStatus: "ready", chatgptAccountId: id })
    homes.push(home)
  }
  const status = new AccountStatusService(config, database)
  services.push(status)
  const warmup = new AccountWarmupService(config, database, status)
  return { root, config, database, status, warmup, homes }
}

/** Put an account's short window where the test needs it. */
function setShortWindow(database: GatewayDatabase, id: string, resetsAt: number | null) {
  database.accounts.updateRateLimits(id, {
    primary: { usedPercent: 0, resetsAt, windowDurationMins: 300 },
    secondary: { usedPercent: 0, resetsAt: Date.now() + 7 * 86_400_000, windowDurationMins: 10080 },
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    resetCredits: null,
    buckets: [],
    defaultBucketKey: null,
  })
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const database of databases.splice(0)) if (database.raw.open) database.close()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("account warm-up", () => {
  it("reads the short window rather than a slot position", () => {
    const soon = Date.now() + 3_600_000
    const account = { primaryWindowMinutes: 10080, primaryResetsAt: soon, secondaryWindowMinutes: 300, secondaryResetsAt: soon } as never
    // The five-hour window is whichever slot is shorter than a day, not
    // whichever one arrived first.
    expect(shortWindowRunning(account, Date.now())).toBe(true)
    const expired = { primaryWindowMinutes: 300, primaryResetsAt: Date.now() - 1, secondaryWindowMinutes: 10080, secondaryResetsAt: soon } as never
    expect(shortWindowRunning(expired, Date.now())).toBe(false)
  })

  it("sends a turn on each account and records that the window started", async () => {
    const { database, warmup } = await fixture(2)
    for (const id of ["account-1", "account-2"]) setShortWindow(database, id, null)

    const run = await warmup.run({ trigger: "manual" })
    expect(run.results.map((r) => r.outcome)).toEqual(["warmed", "warmed"])

    // The point is not that the turn succeeded — it is that the window is now
    // counting, which is what the log has to be able to show.
    for (const result of run.results) {
      expect(result.windowBeforeResetsAt).toBeNull()
      expect(result.windowAfterResetsAt).toBeGreaterThan(Date.now())
    }
    expect(database.warmupLog.recent().map((entry) => entry.outcome)).toEqual(["warmed", "warmed"])
  })

  it("leaves alone an account whose window is already counting", async () => {
    const { database, warmup } = await fixture(2)
    setShortWindow(database, "account-1", Date.now() + 3_600_000)
    setShortWindow(database, "account-2", null)

    // Warming a window that is already running buys nothing and costs quota.
    expect(warmup.pending().map((a) => a.id)).toEqual(["account-2"])
    const run = await warmup.run({ trigger: "manual" })
    expect(run.results).toEqual([
      expect.objectContaining({ accountId: "account-1", outcome: "skipped", skipped: "window_running" }),
      expect.objectContaining({ accountId: "account-2", outcome: "warmed" }),
    ])
    // A skip is not an attempt, so it must not burn the daily allowance.
    expect(database.warmupLog.countSince("account-1", 0)).toBe(0)
  })

  it("warms a running window anyway when a person insists", async () => {
    const { database, warmup } = await fixture(1)
    setShortWindow(database, "account-1", Date.now() + 3_600_000)
    const run = await warmup.run({ trigger: "manual", force: true })
    expect(run.results[0]).toMatchObject({ outcome: "warmed" })
  })

  it("holds an account back inside its cooldown", async () => {
    const { database, warmup } = await fixture(1)
    setShortWindow(database, "account-1", null)
    database.warmupLog.record({
      startedAt: Date.now() - 60_000, accountId: "account-1", trigger: "auto", outcome: "warmed",
      model: "m", durationMs: 1, errorCode: null, windowBeforeResetsAt: null, windowAfterResetsAt: null,
    })
    // An upstream that has not published the new window yet would otherwise be
    // warmed over and over.
    const run = await warmup.run({ trigger: "auto" })
    expect(run.results[0]).toMatchObject({ outcome: "skipped", skipped: "cooldown" })
  })

  it("stops at the daily ceiling even across a restart", async () => {
    const { database, warmup } = await fixture(1)
    setShortWindow(database, "account-1", null)
    const settings = database.settings.warmup()
    for (let i = 0; i < settings.dailyLimit; i += 1) {
      database.warmupLog.record({
        startedAt: Date.now() - settings.cooldownMs - 1000 * (i + 1), accountId: "account-1", trigger: "auto",
        outcome: "warmed", model: "m", durationMs: 1, errorCode: null, windowBeforeResetsAt: null, windowAfterResetsAt: null,
      })
    }
    // The ceiling is counted from the log rather than held in memory, so a
    // gateway that keeps restarting cannot keep spending.
    const run = await warmup.run({ trigger: "auto" })
    expect(run.results[0]).toMatchObject({ outcome: "skipped", skipped: "daily_limit" })
  })

  it("records a failed turn as a classified code, never the upstream message", async () => {
    const { database, warmup, homes } = await fixture(1)
    setShortWindow(database, "account-1", null)
    await writeFile(path.join(homes[0], "force-turn-failure"), "1")

    const run = await warmup.run({ trigger: "manual" })
    expect(run.results[0]).toMatchObject({ outcome: "failed", errorCode: "warmup_failed" })
    const logged = database.warmupLog.recent()[0]
    expect(logged.errorCode).toBe("warmup_failed")
    expect(JSON.stringify(logged)).not.toContain("upstream said no")
  })

  it("carries on to the next account after one fails", async () => {
    const { database, warmup, homes } = await fixture(2)
    for (const id of ["account-1", "account-2"]) setShortWindow(database, id, null)
    await writeFile(path.join(homes[0], "force-turn-failure"), "1")

    const run = await warmup.run({ trigger: "manual" })
    expect(run.results.map((r) => r.outcome)).toEqual(["failed", "warmed"])
  })

  it("refuses a second run while one is in flight", async () => {
    const { database, warmup } = await fixture(1)
    setShortWindow(database, "account-1", null)
    const first = warmup.run({ trigger: "manual" })
    await expect(warmup.run({ trigger: "auto" })).rejects.toThrow("warmup_already_running")
    await first
    // And is free again once it is done.
    await expect(warmup.run({ trigger: "manual", force: true })).resolves.toBeTruthy()
  })

  it("reports progress so the button can say where it is", async () => {
    const { config, database, status } = await fixture(2)
    for (const id of ["account-1", "account-2"]) setShortWindow(database, id, null)
    const seen: Array<{ total: number; done: number }> = []
    const service = new AccountWarmupService(config, database, status, (progress) =>
      seen.push({ total: progress.total, done: progress.done }))
    await service.run({ trigger: "manual" })
    expect(seen[0]).toEqual({ total: 2, done: 0 })
    expect(seen.at(-1)).toEqual({ total: 0, done: 0 })
    expect(seen.some((p) => p.done === 1)).toBe(true)
  })

  it("offers the account's model catalog for the picker", async () => {
    const { warmup } = await fixture(1)
    expect(await warmup.models()).toEqual([
      { id: "gpt-fake-default", displayName: "Fake Default", isDefault: true },
      { id: "gpt-fake-mini", displayName: "Fake Mini", isDefault: false },
    ])
  })

  it("keeps accounts that opted out of warm-up out of the run", async () => {
    const { database, warmup } = await fixture(2)
    for (const id of ["account-1", "account-2"]) setShortWindow(database, id, null)
    database.accounts.update("account-2", { warmupEnrolled: false })
    expect(warmup.candidates().map((a) => a.id)).toEqual(["account-1"])
    const run = await warmup.run({ trigger: "manual" })
    expect(run.results.map((r) => r.accountId)).toEqual(["account-1"])
  })
})
