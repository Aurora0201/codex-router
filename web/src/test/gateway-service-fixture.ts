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
  auth: {
    status: "ready",
    mode: "chatgpt",
    checkedAt: Date.now(),
    lastSuccessfulAt: Date.now(),
    stale: false,
    errorCode: null,
  },
  billing: { anchorAt: null, cadence: null },
  limits: {
    buckets: [],
    defaultBucketKey: null,
    resetCredits: null,
    checkedAt: null,
  },
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
    websocketConnections: [],
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
    async getWebSocketConnections() {
      return structuredClone(snapshot.websocketConnections)
    },
    async getCodexUsage() {
      return { status: "ready", scope: "local_codex_home", generatedAt: Date.now(), timezone: "Asia/Shanghai",
        coverage: { firstEventAt: null, lastEventAt: null, rollouts: 0, sourceRollouts: 0, retainedRollouts: 0, lastScannedAt: null, lastRetentionAt: null, parseWarnings: 0, scan: { complete: true, lastSuccessfulAt: null, pendingMissingRollouts: 0 }, retention: { pendingAuditEvents: 0, lastVerifiedAt: null }, backup: { status: "unavailable" as const, lastSuccessfulAt: null, generations: 0, lastRecoveryAt: null } },
        summary: { totalTokens: 0, todayTokens: 0, dailyAverage: 0, inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cacheHitPercent: 0, sessions: 0, tasksStarted: 0, tasksCompleted: 0, abortedTurns: 0, compactions: 0, completionPercent: 0, tokensPerCompletedTask: 0 },
        daily: [], dailyModels: [], models: [], projects: [], heatmap: [], filters: { models: [], projects: [] } }
    },
    async getRequestLogs() {
      return {
        items: [],
        summary: {
          requests: 0,
          errors: 0,
          rejected: 0,
          cancelled: 0,
          availabilityRequests: 0,
          availabilityErrors: 0,
          averageDurationMs: null,
        },
        timeline: [],
        nextCursor: null,
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      }
    },
    async getWebSocketConnectionLogs() {
      return {
        items: [],
        summary: { connections: 0, failures: 0, retired: 0 },
        nextCursor: null,
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      }
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
      if (values.enabled !== undefined) {
        selected.enabled = values.enabled
        selected.authStatus = values.enabled ? "ready" : "disabled"
      }
      if (values.billingAnchorAt !== undefined && values.billingCadence !== undefined) {
        selected.billing = {
          anchorAt: values.billingAnchorAt,
          cadence: values.billingCadence,
        }
      }
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
    async refreshAllAccountStatus() {
      return { started: true }
    },
    async consumeAccountResetCredit(id) {
      return {
        outcome: "reset" as const,
        account: structuredClone(
          snapshot.accounts.accounts.find((item) => item.id === id)!
        ),
      }
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
