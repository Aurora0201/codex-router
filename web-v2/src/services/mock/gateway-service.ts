import type { Account, CodexStatus, GatewayService, GatewaySnapshot, LoginSession, MockScenario, SettingsState } from "@/services/contracts"

const now = Date.now()
const usage = (usedPercent: number | null, hours: number, windowDurationMins: number) => ({ usedPercent, resetsAt: now + hours * 3_600_000, windowDurationMins })
const account = (values: Partial<Account> & Pick<Account, "id" | "chatgptAccountId">): Account => ({
  email: null, planType: null, enabled: true, authStatus: "ready", rateLimitReachedType: null,
  usage: { primary: null, secondary: null }, lastAuthRefreshAt: now - 900_000, lastLimitsRefreshAt: now - 120_000,
  ...values,
})

const healthyAccounts: Account[] = [
  account({ id: "acc-01", chatgptAccountId: "acct_01JQ7V5DM31YAX8PM0F6K9", email: "lin@example.com", planType: "Plus", usage: { primary: usage(28, 2, 300), secondary: usage(63, 96, 10080) } }),
  account({ id: "acc-02", chatgptAccountId: "acct_01JR8N2XZ61VHT3QK4B7SA", email: "studio@example.com", planType: "Team", authStatus: "rate_limited", rateLimitReachedType: "primary", usage: { primary: usage(100, 1, 300), secondary: usage(74, 72, 10080) } }),
  account({ id: "acc-03", chatgptAccountId: "acct_01JT4K9WD72MBC5FL8H0RE", email: "archive@example.com", planType: "Free", authStatus: "relogin_required", usage: { primary: null, secondary: null }, lastAuthRefreshAt: null, lastLimitsRefreshAt: null }),
  account({ id: "acc-04", chatgptAccountId: "acct_01JV6Y3HF82KDP9MN5W1TC", email: "secure@example.com", planType: "Enterprise", authStatus: "unsupported_fedramp", usage: { primary: usage(null, 4, 300), secondary: null } }),
  account({ id: "acc-05", chatgptAccountId: "acct_01JW2B8QL94XAF7RC3S6NP", email: "paused@example.com", planType: "Plus", enabled: false, authStatus: "disabled", usage: { primary: usage(11, 3, 300), secondary: usage(22, 120, 10080) } }),
]

const makeSnapshot = (scenario: MockScenario): GatewaySnapshot => ({
  version: "0.3.0-preview", online: scenario !== "offline", activeAccountId: scenario === "healthy" ? "acc-01" : null,
  accounts: scenario === "empty" ? [] : structuredClone(healthyAccounts), requestsToday: scenario === "offline" ? 0 : 1842,
  errorsToday: scenario === "degraded" ? 87 : 3, activeRequests: scenario === "offline" ? 0 : 4,
  activeWebSockets: scenario === "offline" ? 0 : 2, uptimeSeconds: scenario === "offline" ? 0 : 18420,
})

let scenario: MockScenario = "healthy"
let snapshot = makeSnapshot(scenario)
let settings: SettingsState = { gatewayAddress: "127.0.0.1", gatewayPort: 8317, upstream: "https://chatgpt.com/backend-api/codex", requestMetadataLogging: true, promptLogging: false, theme: "system" }
let codex: CodexStatus = { configPath: "C:\\Users\\demo\\.codex\\config.toml", openaiBaseUrl: null, gatewayBaseUrl: "http://127.0.0.1:8317/backend-api/codex", applied: false, modelCatalogJson: null, hasBackup: false, configExists: true, codexRunning: true }
const logins = new Map<string, LoginSession & { polls: number }>()

const wait = () => new Promise((resolve) => window.setTimeout(resolve, 240))
const clone = <T>(value: T): T => structuredClone(value)
const requireOnline = () => { if (!snapshot.online) throw new Error("Gateway 当前离线，请切换 Mock 场景后重试") }
const findAccount = (id: string) => { const found = snapshot.accounts.find((item) => item.id === id); if (!found) throw new Error("account_not_found"); return found }

export const mockScenarioController = {
  getScenario: () => scenario,
  setScenario(next: MockScenario) { scenario = next; snapshot = makeSnapshot(next) },
}

export const mockGatewayService: GatewayService = {
  async getSnapshot() { await wait(); if (scenario === "offline") return clone(snapshot); return clone(snapshot) },
  async setActiveAccount(id) { await wait(); requireOnline(); const target = findAccount(id); if (!target.enabled || target.authStatus !== "ready") throw new Error("该账号当前不可用"); snapshot.activeAccountId = id; return clone(snapshot) },
  async clearActiveAccount() { await wait(); requireOnline(); snapshot.activeAccountId = null; return clone(snapshot) },
  async setAccountEnabled(id, enabled) { await wait(); requireOnline(); const target = findAccount(id); target.enabled = enabled; target.authStatus = enabled ? "ready" : "disabled"; if (!enabled && snapshot.activeAccountId === id) snapshot.activeAccountId = null; return clone(snapshot) },
  async removeAccount(id) { await wait(); requireOnline(); findAccount(id); snapshot.accounts = snapshot.accounts.filter((item) => item.id !== id); if (snapshot.activeAccountId === id) snapshot.activeAccountId = null; return clone(snapshot) },
  async refreshUsage(id) { await wait(); requireOnline(); const target = findAccount(id); target.lastLimitsRefreshAt = Date.now(); if (target.authStatus === "rate_limited") { target.authStatus = "ready"; target.rateLimitReachedType = null; target.usage.primary = usage(42, 4, 300) } return clone(snapshot) },
  async refreshAuth(id) { await wait(); requireOnline(); const target = findAccount(id); target.authStatus = "refreshing"; await wait(); target.authStatus = "ready"; target.enabled = true; target.lastAuthRefreshAt = Date.now(); return clone(snapshot) },
  async startLogin() { await wait(); requireOnline(); const loginId = `login-${Date.now()}`; const session = { loginId, authUrl: `https://auth.openai.example/mock/${loginId}`, status: "launching" as const, polls: 0 }; logins.set(loginId, session); return clone(session) },
  async getLogin(id) { await wait(); const session = logins.get(id); if (!session) throw new Error("login_not_found"); if (!["complete", "failed", "cancelled"].includes(session.status)) { session.polls += 1; session.status = session.polls < 2 ? "waiting" : session.polls < 4 ? "completing" : scenario === "degraded" ? "failed" : "complete"; if (session.status === "failed") session.error = "模拟 OAuth 完成失败"; if (session.status === "complete" && !session.createdAccountId) { session.createdAccountId = "acct_01MOCKNEWACCOUNT000001"; snapshot.accounts.push(account({ id: `acc-${Date.now()}`, chatgptAccountId: session.createdAccountId, email: "new.account@example.com", planType: "Plus", usage: { primary: usage(0, 5, 300), secondary: usage(0, 168, 10080) } })) } } return clone(session) },
  async cancelLogin(id) { await wait(); const session = logins.get(id); if (!session) throw new Error("login_not_found"); session.status = "cancelled"; return clone(session) },
  async getSettings() { await wait(); return clone(settings) },
  async updateSettings(values) { await wait(); requireOnline(); settings = { ...settings, ...values, promptLogging: false }; return clone(settings) },
  async getCodexStatus() { await wait(); return clone(codex) },
  async applyCodexConfig() { await wait(); requireOnline(); codex = { ...codex, applied: true, hasBackup: true, openaiBaseUrl: codex.gatewayBaseUrl }; return clone(codex) },
  async restoreCodexConfig() { await wait(); requireOnline(); codex = { ...codex, applied: false, openaiBaseUrl: null }; return clone(codex) },
  async restartCodex() { await wait(); requireOnline(); codex = { ...codex, codexRunning: false }; await wait(); codex = { ...codex, codexRunning: true }; return clone(codex) },
}
