import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { AccountService } from "../src/accounts/account-service.js"
import { loadConfig } from "../src/config.js"
import { GatewayDatabase } from "../src/db/database.js"

const roots: string[] = []
const databases: GatewayDatabase[] = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "account-cleanup-test-"))
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
  await mkdir(config.accountsDir, { recursive: true })
  return { root, config, database, service: new AccountService(config, database) }
}

/** An account directory as a login leaves it: credentials under `codex-home`. */
async function plantDirectory(accountsDir: string, id: string): Promise<string> {
  const home = path.join(accountsDir, id, "codex-home")
  await mkdir(home, { recursive: true })
  await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "x" } }))
  return path.join(accountsDir, id)
}

const KNOWN = "11111111-1111-4111-8111-111111111111"
const ORPHAN = "22222222-2222-4222-8222-222222222222"

afterEach(async () => {
  for (const database of databases.splice(0)) if (database.raw.open) database.close()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe("orphan account directories", () => {
  it("removes credentials no account row owns, and keeps the ones that are owned", async () => {
    const { config, database, service } = await fixture()
    const kept = await plantDirectory(config.accountsDir, KNOWN)
    await plantDirectory(config.accountsDir, ORPHAN)
    database.accounts.insert({ id: KNOWN, codexHome: path.join(kept, "codex-home") })

    // A login writes the directory before the row, so a crash in that window
    // leaves a real auth.json that removing the account can never reach.
    expect(await service.cleanupOrphanDirectories()).toEqual([ORPHAN])
    expect((await readdir(config.accountsDir)).sort()).toEqual([KNOWN])
  })

  it("leaves alone anything not named like a directory a login would have made", async () => {
    const { config, service } = await fixture()
    await mkdir(path.join(config.accountsDir, "backups"), { recursive: true })
    await mkdir(path.join(config.accountsDir, "not-a-uuid"), { recursive: true })
    await writeFile(path.join(config.accountsDir, "notes.txt"), "keep me")

    // This deletes credentials, so it only ever touches the exact shape the
    // login flow produces.
    expect(await service.cleanupOrphanDirectories()).toEqual([])
    expect((await readdir(config.accountsDir)).sort()).toEqual(["backups", "not-a-uuid", "notes.txt"])
  })

  it("says nothing was removed when the accounts root does not exist yet", async () => {
    const { config, service } = await fixture()
    await rm(config.accountsDir, { recursive: true, force: true })
    expect(await service.cleanupOrphanDirectories()).toEqual([])
  })
})
