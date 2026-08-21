import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { AccountStatusService } from "../src/accounts/account-status-service.js"
import { parseRateLimitResponse } from "../src/accounts/rate-limit-parser.js"
import { loadConfig } from "../src/config.js"
import { GatewayDatabase } from "../src/db/database.js"

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-status-test-"))
  roots.push(root)
  const accountHome = path.join(root, "account")
  await mkdir(accountHome, { recursive: true })
  await writeFile(path.join(accountHome, "auth.json"), JSON.stringify({ tokens: { access_token: "test-access", account_id: "account-id", refresh_token: "test-refresh" } }))
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
  database.accounts.insert({ id: "account", codexHome: accountHome })
  database.accounts.update("account", { authStatus: "ready", chatgptAccountId: "account-id" })
  return { root, accountHome, database, service: new AccountStatusService(config, database) }
}
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("dynamic account status", () => {
  it("whitelists dynamic windows, credits, individual limits and reset credits", () => {
    const snapshot = parseRateLimitResponse({
      rateLimits: {
        primary: { usedPercent: 20, resetsAt: 2_000_000_000, windowDurationMins: 300 },
        secondary: { usedPercent: 40, resetsAt: 2_000_000_100, windowDurationMins: 10080 },
        credits: { hasCredits: true, unlimited: false, balance: "12.5" },
        individualLimit: { limit: "100", used: "25", remainingPercent: 75, resetsAt: 2_000_000_200 },
        spendControlReached: false,
      },
      rateLimitsByLimitId: {
        codex_other: { limitId: "codex_other", limitName: "Other", primary: { usedPercent: 5, windowDurationMins: 1440 } },
      },
      rateLimitReachedType: "weekly",
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{ id: "opaque-credit", resetType: "weekly", status: "available", grantedAt: 2_000_000_000, expiresAt: 2_000_100_000 }],
      },
      unknownFutureField: { secret: "ignored" },
    })
    expect(snapshot.primary?.windowDurationMins).toBe(300)
    expect(snapshot.secondary?.windowDurationMins).toBe(10080)
    expect(snapshot.buckets).toHaveLength(2)
    expect(snapshot.buckets[0]).toMatchObject({
      credits: expect.objectContaining({ balance: "12.5", unlimited: false }),
      individualLimit: expect.objectContaining({ remainingPercent: 75 }),
      spendControlReached: false,
    })
    expect(snapshot.rateLimitReachedType).toBe("weekly")
    expect(snapshot.buckets[1]).toMatchObject({ limitId: "codex_other", limitName: "Other" })
    expect(snapshot.resetCredits?.credits?.[0]).toMatchObject({ id: "opaque-credit", status: "available" })
    expect(JSON.stringify(snapshot)).not.toContain("unknownFutureField")
    expect(JSON.stringify(snapshot)).not.toContain("secret")
  })

  it("single-flights account and limit reads, persists one fresh snapshot, and consumes a credit", async () => {
    const { accountHome, database, service } = await fixture()
    const [first, second, third] = await Promise.all([service.refresh("account"), service.refresh("account"), service.refresh("account")])
    expect(first).toEqual(second)
    expect(second).toEqual(third)
    const rpc = await readFile(path.join(accountHome, "rpc.log"), "utf8")
    expect(rpc.match(/account\/read/g)).toHaveLength(1)
    expect(rpc.match(/account\/rateLimits\/read/g)).toHaveLength(1)
    expect(database.accounts.get("account")).toMatchObject({
      authStatus: "ready",
      authMode: "chatgpt",
      authErrorCode: null,
      primaryWindowMinutes: 300,
      secondaryWindowMinutes: 10080,
    })
    expect(JSON.parse(database.accounts.get("account")!.limitsSnapshotJson!)).toMatchObject({
      buckets: [expect.objectContaining({ credits: expect.objectContaining({ balance: "42" }), individualLimit: expect.objectContaining({ remainingPercent: 80 }) })],
      resetCredits: expect.objectContaining({ availableCount: 1 }),
    })
    await expect(service.consumeResetCredit("account", "00000000-0000-4000-8000-000000000001", "credit-1")).resolves.toBe("reset")
    database.close()
  })

  it("preserves the last ready snapshot for transient failures but marks explicit login loss", async () => {
    const transient = await fixture()
    const transientMarker = path.join(transient.accountHome, "force-transient")
    await writeFile(transientMarker, "")
    await expect(transient.service.refresh("account", { checking: false })).rejects.toThrow("temporary service unavailable")
    expect(transient.database.accounts.get("account")).toMatchObject({ authStatus: "ready", authErrorCode: "status_check_failed" })

    await rm(transientMarker, { force: true })
    await writeFile(path.join(transient.accountHome, "force-relogin"), "")
    await expect(transient.service.refresh("account")).rejects.toThrow("account_relogin_required")
    expect(transient.database.accounts.get("account")).toMatchObject({ authStatus: "relogin_required", authErrorCode: "relogin_required" })
    transient.database.close()
  })
})
