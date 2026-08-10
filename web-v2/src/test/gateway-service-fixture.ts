import type {
  AccountView,
  GatewayService,
  GatewaySnapshot,
  LoginSessionView,
} from "@/services/contracts"

const account = (id: string, isActive = false): AccountView => ({
  id,
  chatgptAccountId: `chatgpt-${id}`,
  email: `${id}@example.com`,
  planType: "Plus",
  enabled: true,
  isActive,
  authStatus: "ready",
  rateLimitReachedType: null,
  usage: { primary: null, secondary: null },
  lastAuthRefreshAt: null,
  lastLimitsRefreshAt: null,
})

export function createGatewayServiceFixture({
  activeAccountId = "account-1",
  degraded = false,
  stats = {},
}: {
  activeAccountId?: string | null
  degraded?: boolean
  stats?: Partial<GatewaySnapshot["stats"]>
} = {}): GatewayService & { snapshot: GatewaySnapshot } {
  const accounts = [
    account("account-1", activeAccountId === "account-1"),
    account("account-2", activeAccountId === "account-2"),
    account("account-3", activeAccountId === "account-3"),
  ]
  let login: LoginSessionView = {
    loginId: "login-1",
    authUrl: "https://auth.openai.test/codex",
    status: "waiting",
  }
  const snapshot: GatewaySnapshot = {
    health: {
      status: "ok",
      upstream: "configured",
      accounts: accounts.length,
      csrfToken: "test-csrf",
      version: "0.2.0",
      dataDir: "C:\\Users\\test\\.codex-router",
      databasePath: "C:\\Users\\test\\.codex-router\\gateway.db",
      logFilePath: "C:\\Users\\test\\.codex-router\\logs\\gateway.log",
    },
    stats: {
      uptimeSeconds: 76_440,
      requestsToday: 1_284,
      errorsToday: degraded ? 19 : 3,
      accountsReady: 3,
      ...stats,
    },
    accounts: { activeAccountId, accounts },
    settings: {
      gatewayAddress: "127.0.0.1",
      gatewayPort: 8317,
      upstream: "https://chatgpt.com/backend-api/codex",
      requestMetadataLogging: true,
      logLevel: "info",
      theme: "system",
    },
    codex: {
      configPath: "C:\\Users\\test\\.codex\\config.toml",
      backupPath: "C:\\Users\\test\\.codex\\config.toml.gateway.bak",
      openaiBaseUrl: degraded
        ? "https://chatgpt.com/backend-api/codex"
        : "http://127.0.0.1:8317/backend-api/codex",
      gatewayBaseUrl: "http://127.0.0.1:8317/backend-api/codex",
      applied: !degraded,
      modelCatalogJson: null,
      hasBackup: true,
      configExists: true,
      codexRunning: !degraded,
    },
  }

  const service: GatewayService & { snapshot: GatewaySnapshot } = {
    snapshot,
    subscribe() {
      return () => undefined
    },
    async getSnapshot() {
      return structuredClone(snapshot)
    },
    async getAccounts() {
      return structuredClone(snapshot.accounts)
    },
    async getRequestLogs() {
      return { items: [], summary: { requests: 0, errors: 0, averageDurationMs: null }, timeline: [], nextCursor: null }
    },
    async setActiveAccount(id) {
      snapshot.accounts.activeAccountId = id
      snapshot.accounts.accounts.forEach((item) => {
        item.isActive = item.id === id
      })
      return structuredClone(
        snapshot.accounts.accounts.find((item) => item.id === id)!
      )
    },
    async clearActiveAccount() {
      snapshot.accounts.activeAccountId = null
      snapshot.accounts.accounts.forEach((item) => (item.isActive = false))
    },
    async updateAccount(id, values) {
      const selected = snapshot.accounts.accounts.find(
        (item) => item.id === id
      )!
      selected.enabled = values.enabled
      selected.authStatus = values.enabled ? "ready" : "disabled"
      return structuredClone(selected)
    },
    async removeAccount(id) {
      snapshot.accounts.accounts = snapshot.accounts.accounts.filter(
        (item) => item.id !== id
      )
    },
    async refreshAccountAuth(id) {
      return structuredClone(
        snapshot.accounts.accounts.find((item) => item.id === id)!
      )
    },
    async refreshAccountLimits(id) {
      return structuredClone(
        snapshot.accounts.accounts.find((item) => item.id === id)!
      )
    },
    async startLogin() {
      return structuredClone(login)
    },
    async getLoginStatus() {
      return structuredClone(login)
    },
    async cancelLogin() {
      login = { ...login, status: "cancelled" }
    },
    async saveSettings(values) {
      snapshot.settings = { ...snapshot.settings, ...values }
      return structuredClone(snapshot.settings)
    },
    async applyCodexConfig() {
      snapshot.codex.applied = true
      return structuredClone(snapshot.codex)
    },
    async restoreCodexConfig() {
      snapshot.codex.applied = false
      return structuredClone(snapshot.codex)
    },
    async restartCodex() {
      snapshot.codex.codexRunning = true
      return { running: true, codexPath: "C:\\Program Files\\Codex\\Codex.exe" }
    },
  }
  return service
}
