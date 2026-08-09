import type {
  AccountView,
  AccountsResponse,
  CodexStatusView,
  GatewayService,
  GatewaySnapshot,
  LoginSessionView,
  MockScenario,
  MockScenarioController,
  SettingsView,
} from "@/services/contracts"

const NOW = Date.now()

const seedAccounts: AccountView[] = [
  {
    id: "f0652969-1bbf-46e3-bf0b-395dc1396d2f",
    chatgptAccountId: "account-01HTF8R9J2K4N6P8Q0S2V4X6Z8",
    email: "lin.qiao@example.com",
    planType: "Plus",
    enabled: true,
    isActive: true,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: {
      primary: {
        usedPercent: 28,
        resetsAt: NOW + 2 * 3_600_000,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 46,
        resetsAt: NOW + 3 * 86_400_000,
        windowDurationMins: 10080,
      },
    },
    lastAuthRefreshAt: NOW - 11 * 60_000,
    lastLimitsRefreshAt: NOW - 4 * 60_000,
  },
  {
    id: "34f78fd4-1b8d-4ef5-a66e-a3f3e521c382",
    chatgptAccountId: "account-01HTH4J6M8P0R2T4V6X8Z0B2D4",
    email: "operations.long-address@example.org",
    planType: "Team",
    enabled: true,
    isActive: false,
    authStatus: "rate_limited",
    rateLimitReachedType: "primary",
    usage: {
      primary: {
        usedPercent: 100,
        resetsAt: NOW + 38 * 60_000,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 73,
        resetsAt: NOW + 5 * 86_400_000,
        windowDurationMins: 10080,
      },
    },
    lastAuthRefreshAt: NOW - 45 * 60_000,
    lastLimitsRefreshAt: NOW - 8 * 60_000,
  },
  {
    id: "7fbd28a1-2a73-45a4-af79-12c39df28429",
    chatgptAccountId: "account-01HTK8N0Q2S4V6X8Z0B2D4F6H8",
    email: "design@example.net",
    planType: "Pro",
    enabled: true,
    isActive: false,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: {
      primary: { usedPercent: null, resetsAt: null, windowDurationMins: 300 },
      secondary: {
        usedPercent: null,
        resetsAt: null,
        windowDurationMins: 10080,
      },
    },
    lastAuthRefreshAt: NOW - 2 * 3_600_000,
    lastLimitsRefreshAt: null,
  },
  {
    id: "23a4f612-dd36-4bdd-bf16-063b746d07c6",
    chatgptAccountId: "account-01HTM2P4R6T8V0X2Z4B6D8F0H2",
    email: "qa@example.com",
    planType: "Plus",
    enabled: false,
    isActive: false,
    authStatus: "disabled",
    rateLimitReachedType: null,
    usage: {
      primary: {
        usedPercent: 12,
        resetsAt: NOW + 4 * 3_600_000,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 31,
        resetsAt: NOW + 6 * 86_400_000,
        windowDurationMins: 10080,
      },
    },
    lastAuthRefreshAt: NOW - 86_400_000,
    lastLimitsRefreshAt: NOW - 86_400_000,
  },
  {
    id: "0ecb267c-c5af-45df-80ae-14d0e8b95bea",
    chatgptAccountId: "account-01HTQ6S8V0X2Z4B6D8F0H2J4L6",
    email: "backup@example.com",
    planType: "Free",
    enabled: true,
    isActive: false,
    authStatus: "relogin_required",
    rateLimitReachedType: null,
    usage: { primary: null, secondary: null },
    lastAuthRefreshAt: NOW - 7 * 86_400_000,
    lastLimitsRefreshAt: NOW - 7 * 86_400_000,
  },
  {
    id: "a3e43d34-777d-43f9-ae52-f6bb9d2d8205",
    chatgptAccountId: "account-01HTT0V2X4Z6B8D0F2H4J6L8N0",
    email: "research@example.com",
    planType: "Plus",
    enabled: true,
    isActive: false,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: {
      primary: {
        usedPercent: 9,
        resetsAt: NOW + 5 * 3_600_000,
        windowDurationMins: 300,
      },
      secondary: {
        usedPercent: 18,
        resetsAt: NOW + 7 * 86_400_000,
        windowDurationMins: 10080,
      },
    },
    lastAuthRefreshAt: NOW - 22 * 60_000,
    lastLimitsRefreshAt: NOW - 12 * 60_000,
  },
]

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createMockGatewayService(
  initialScenario: MockScenario = "healthy"
): GatewayService & MockScenarioController {
  let scenario = initialScenario
  let accounts = clone(seedAccounts)
  let activeAccountId: string | null = accounts[0].id
  let login: LoginSessionView | null = null
  let loginChecks = 0
  let settings: SettingsView = {
    gatewayAddress: "127.0.0.1",
    gatewayPort: 8317,
    upstream: "https://chatgpt.com/backend-api/codex",
    requestMetadataLogging: true,
    promptLogging: false,
    theme: "system",
  }
  let codex: CodexStatusView = {
    configPath: "C:\\Users\\demo\\.codex\\config.toml",
    openaiBaseUrl: "http://127.0.0.1:8317/backend-api/codex",
    gatewayBaseUrl: "http://127.0.0.1:8317/backend-api/codex",
    applied: true,
    modelCatalogJson: null,
    hasBackup: true,
    configExists: true,
    codexRunning: true,
  }

  const wait = () =>
    new Promise<void>((resolve) => window.setTimeout(resolve, 180))
  const failOffline = () => {
    if (scenario === "offline") throw new Error("mock_gateway_offline")
  }
  const find = (id: string) => {
    const account = accounts.find((item) => item.id === id)
    if (!account) throw new Error("account_not_found")
    return account
  }
  const viewAccounts = (): AccountsResponse => {
    const visible = scenario === "empty" ? [] : accounts
    const selected = scenario === "no-active" ? null : activeAccountId
    return {
      activeAccountId: selected,
      accounts: visible.map((account) => ({
        ...clone(account),
        isActive: account.id === selected,
      })),
    }
  }
  const getCodex = () =>
    scenario === "degraded"
      ? {
          ...codex,
          applied: false,
          openaiBaseUrl: "https://chatgpt.com/backend-api/codex",
          codexRunning: false,
        }
      : codex

  const service: GatewayService & MockScenarioController = {
    getScenario: () => scenario,
    setScenario: (next) => {
      scenario = next
    },
    async getSnapshot() {
      await wait()
      failOffline()
      const accountView = viewAccounts()
      return clone({
        health: {
          status: "ok",
          upstream: "configured",
          accounts: accountView.accounts.length,
          csrfToken: "mock-csrf",
          version: "0.2.0",
        },
        stats: {
          uptimeSeconds: 76_440,
          requestsToday: 1_284,
          errorsToday: scenario === "degraded" ? 19 : 3,
          accountsReady: accountView.accounts.filter(
            (account) => account.enabled && account.authStatus === "ready"
          ).length,
        },
        accounts: accountView,
        settings,
        codex: getCodex(),
      } satisfies GatewaySnapshot)
    },
    async getAccounts() {
      await wait()
      failOffline()
      return clone(viewAccounts())
    },
    async setActiveAccount(id) {
      await wait()
      failOffline()
      const account = find(id)
      if (!account.enabled || account.authStatus !== "ready")
        throw new Error("account_not_ready")
      activeAccountId = id
      return clone({ ...account, isActive: true })
    },
    async clearActiveAccount() {
      await wait()
      failOffline()
      activeAccountId = null
    },
    async updateAccount(id, values) {
      await wait()
      failOffline()
      const account = find(id)
      account.enabled = values.enabled
      account.authStatus = values.enabled ? "ready" : "disabled"
      if (!values.enabled && activeAccountId === id) activeAccountId = null
      return clone(account)
    },
    async removeAccount(id) {
      await wait()
      failOffline()
      find(id)
      accounts = accounts.filter((account) => account.id !== id)
      if (activeAccountId === id) activeAccountId = null
    },
    async refreshAccountAuth(id) {
      await wait()
      failOffline()
      const account = find(id)
      account.authStatus = account.enabled ? "ready" : "disabled"
      account.lastAuthRefreshAt = Date.now()
      return clone(account)
    },
    async refreshAccountLimits(id) {
      await wait()
      failOffline()
      const account = find(id)
      account.lastLimitsRefreshAt = Date.now()
      if (account.usage.primary)
        account.usage.primary.usedPercent = Math.max(
          0,
          (account.usage.primary.usedPercent ?? 24) - 4
        )
      return clone(account)
    },
    async startLogin() {
      await wait()
      failOffline()
      loginChecks = 0
      login = {
        loginId: "mock-login-001",
        authUrl: "https://auth.openai.com/mock/codex",
        status: "waiting",
      }
      return clone(login)
    },
    async getLoginStatus(loginId) {
      await wait()
      failOffline()
      if (!login || login.loginId !== loginId)
        throw new Error("login_not_found")
      loginChecks += 1
      if (loginChecks >= 3 && login.status === "waiting") {
        const created = clone(seedAccounts[2])
        created.id = "mock-created-account"
        created.chatgptAccountId = "account-01HTNEW2X4Z6B8D0F2H4J6L8N0"
        created.email = "new.account@example.com"
        created.isActive = false
        accounts.push(created)
        login = { ...login, status: "complete", createdAccountId: created.id }
      }
      return clone(login)
    },
    async cancelLogin(loginId) {
      await wait()
      failOffline()
      if (!login || login.loginId !== loginId)
        throw new Error("login_not_found")
      login.status = "cancelled"
    },
    async saveSettings(values) {
      await wait()
      failOffline()
      settings = { ...settings, ...values }
      return clone(settings)
    },
    async applyCodexConfig() {
      await wait()
      failOffline()
      codex = {
        ...codex,
        applied: true,
        openaiBaseUrl: codex.gatewayBaseUrl,
        hasBackup: true,
      }
      return clone(codex)
    },
    async restoreCodexConfig() {
      await wait()
      failOffline()
      codex = {
        ...codex,
        applied: false,
        openaiBaseUrl: "https://chatgpt.com/backend-api/codex",
      }
      return clone(codex)
    },
    async restartCodex() {
      await wait()
      failOffline()
      codex = { ...codex, codexRunning: true }
      return { running: true, codexPath: "C:\\Program Files\\Codex\\Codex.exe" }
    },
  }
  return service
}

export function scenarioFromUrl(search = window.location.search): MockScenario {
  const value = new URLSearchParams(search).get("scenario")
  return ["healthy", "empty", "no-active", "degraded", "offline"].includes(
    value ?? ""
  )
    ? (value as MockScenario)
    : "healthy"
}
