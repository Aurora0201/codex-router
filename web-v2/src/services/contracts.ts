export type AuthStatus =
  | "login_pending"
  | "ready"
  | "refreshing"
  | "rate_limited"
  | "relogin_required"
  | "unsupported_fedramp"
  | "disabled"
  | "error"

export interface UsageWindowView {
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
}

export interface AccountView {
  id: string
  chatgptAccountId: string | null
  email: string | null
  planType: string | null
  enabled: boolean
  isActive: boolean
  authStatus: AuthStatus
  rateLimitReachedType: string | null
  usage: {
    primary: UsageWindowView | null
    secondary: UsageWindowView | null
  }
  lastAuthRefreshAt: number | null
  lastLimitsRefreshAt: number | null
}

export interface AccountsResponse {
  activeAccountId: string | null
  accounts: AccountView[]
}

export interface HealthView {
  status: "ok"
  upstream: "configured"
  accounts: number
  csrfToken: string
  version: string
}

export interface StatsView {
  uptimeSeconds: number
  requestsToday: number
  errorsToday: number
  accountsReady: number
}

export interface SettingsView {
  gatewayAddress: string
  gatewayPort: number
  upstream: string
  requestMetadataLogging: boolean
  promptLogging: false
  theme: "system" | "light" | "dark"
}

export interface LoginSessionView {
  loginId: string
  authUrl: string
  status: "waiting" | "complete" | "failed" | "cancelled"
  error?: string
  createdAccountId?: string
}

export interface CodexStatusView {
  configPath: string
  openaiBaseUrl: string | null
  gatewayBaseUrl: string
  applied: boolean
  modelCatalogJson: string | null
  hasBackup: boolean
  configExists: boolean
  codexRunning: boolean
}

export type MockScenario =
  "healthy" | "empty" | "no-active" | "degraded" | "offline"

export interface GatewaySnapshot {
  health: HealthView
  stats: StatsView
  accounts: AccountsResponse
  settings: SettingsView
  codex: CodexStatusView
}

export interface GatewayService {
  getSnapshot(): Promise<GatewaySnapshot>
  getAccounts(): Promise<AccountsResponse>
  setActiveAccount(id: string): Promise<AccountView>
  clearActiveAccount(): Promise<void>
  updateAccount(id: string, values: { enabled: boolean }): Promise<AccountView>
  removeAccount(id: string): Promise<void>
  refreshAccountAuth(id: string): Promise<AccountView>
  refreshAccountLimits(id: string): Promise<AccountView>
  startLogin(): Promise<LoginSessionView>
  getLoginStatus(loginId: string): Promise<LoginSessionView>
  cancelLogin(loginId: string): Promise<void>
  saveSettings(
    values: Pick<SettingsView, "requestMetadataLogging" | "theme">
  ): Promise<SettingsView>
  applyCodexConfig(): Promise<CodexStatusView>
  restoreCodexConfig(): Promise<CodexStatusView>
  restartCodex(): Promise<{ running: boolean; codexPath: string | null }>
}

export interface MockScenarioController {
  getScenario(): MockScenario
  setScenario(scenario: MockScenario): void
}
