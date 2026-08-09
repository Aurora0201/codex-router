export type AccountAuthStatus = "ready" | "refreshing" | "rate_limited" | "relogin_required" | "unsupported_fedramp" | "disabled" | "login_pending" | "error"
export type ThemePreference = "system" | "light" | "dark"
export type LoginStatus = "launching" | "waiting" | "completing" | "complete" | "failed" | "cancelled"
export type MockScenario = "healthy" | "empty" | "no-active" | "degraded" | "offline"

export interface UsageWindow {
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
}

export interface Account {
  id: string
  chatgptAccountId: string
  email: string | null
  planType: string | null
  enabled: boolean
  authStatus: AccountAuthStatus
  rateLimitReachedType: string | null
  usage: { primary: UsageWindow | null; secondary: UsageWindow | null }
  lastAuthRefreshAt: number | null
  lastLimitsRefreshAt: number | null
}

export interface GatewaySnapshot {
  version: string
  online: boolean
  activeAccountId: string | null
  accounts: Account[]
  requestsToday: number
  errorsToday: number
  activeRequests: number
  activeWebSockets: number
  uptimeSeconds: number
}

export interface SettingsState {
  gatewayAddress: string
  gatewayPort: number
  upstream: string
  requestMetadataLogging: boolean
  promptLogging: false
  theme: ThemePreference
}

export interface CodexStatus {
  configPath: string
  openaiBaseUrl: string | null
  gatewayBaseUrl: string
  applied: boolean
  modelCatalogJson: string | null
  hasBackup: boolean
  configExists: boolean
  codexRunning: boolean
}

export interface LoginSession {
  loginId: string
  authUrl: string
  status: LoginStatus
  error?: string
  createdAccountId?: string
}

export interface GatewayService {
  getSnapshot(): Promise<GatewaySnapshot>
  setActiveAccount(accountId: string): Promise<GatewaySnapshot>
  clearActiveAccount(): Promise<GatewaySnapshot>
  setAccountEnabled(accountId: string, enabled: boolean): Promise<GatewaySnapshot>
  removeAccount(accountId: string): Promise<GatewaySnapshot>
  refreshUsage(accountId: string): Promise<GatewaySnapshot>
  refreshAuth(accountId: string): Promise<GatewaySnapshot>
  startLogin(): Promise<LoginSession>
  getLogin(loginId: string): Promise<LoginSession>
  cancelLogin(loginId: string): Promise<LoginSession>
  getSettings(): Promise<SettingsState>
  updateSettings(values: Pick<SettingsState, "requestMetadataLogging" | "theme">): Promise<SettingsState>
  getCodexStatus(): Promise<CodexStatus>
  applyCodexConfig(): Promise<CodexStatus>
  restoreCodexConfig(): Promise<CodexStatus>
  restartCodex(): Promise<CodexStatus>
}
