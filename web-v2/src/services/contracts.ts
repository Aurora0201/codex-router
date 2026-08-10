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
  dataDir: string
  databasePath: string
  logFilePath: string | null
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
  logLevel: "debug" | "info" | "warn" | "error"
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
  backupPath: string
  openaiBaseUrl: string | null
  gatewayBaseUrl: string
  applied: boolean
  modelCatalogJson: string | null
  hasBackup: boolean
  configExists: boolean
  codexRunning: boolean
}

export interface GatewaySnapshot {
  health: HealthView
  stats: StatsView
  accounts: AccountsResponse
  settings: SettingsView
  codex: CodexStatusView
}

export type GatewayResource = "accounts" | "stats" | "settings" | "codex" | "logs"

export type RequestLogRange = "1h" | "24h" | "7d"
export interface RequestLogFilters {
  range: RequestLogRange
  status?: "success" | "error"
  transport?: "http" | "ws" | "compact" | "models" | "search"
  accountId?: string
  query?: string
  cursor?: string
  limit?: number
}
export interface RequestLogView {
  id: string
  requestId?: string
  route: string
  transport: "http" | "ws" | "compact" | "models" | "search"
  accountId?: string
  accountLabel: string | null
  statusCode?: number
  durationMs?: number
  bytesIn?: number
  bytesOut?: number
  errorCode?: string
  createdAt: number
}
export interface RequestLogsResponse {
  items: RequestLogView[]
  summary: { requests: number; errors: number; averageDurationMs: number | null }
  timeline: Array<{
    id: string
    createdAt: number
    durationMs: number
    statusCode: number | null
  }>
  nextCursor: string | null
}

export interface GatewayService {
  subscribe(
    onInvalidate: (resources: GatewayResource[]) => void,
    onConnectionChange: (connected: boolean) => void
  ): () => void
  getSnapshot(): Promise<GatewaySnapshot>
  getAccounts(): Promise<AccountsResponse>
  getRequestLogs(filters: RequestLogFilters): Promise<RequestLogsResponse>
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
    values: Partial<Pick<SettingsView, "requestMetadataLogging" | "theme" | "logLevel">>
  ): Promise<SettingsView>
  applyCodexConfig(): Promise<CodexStatusView>
  restoreCodexConfig(): Promise<CodexStatusView>
  restartCodex(): Promise<{ running: boolean; codexPath: string | null }>
}
