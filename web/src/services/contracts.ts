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

export type WebSocketConnectionState =
  | "connecting"
  | "idle"
  | "transmitting"
  | "retiring"

export interface WebSocketConnectionView {
  connectionId: string
  state: WebSocketConnectionState
  connectedAt: number
  activeRequestId?: string
}

export interface GatewaySnapshot {
  health: HealthView
  stats: StatsView
  accounts: AccountsResponse
  settings: SettingsView
  codex: CodexStatusView
  websocketConnections: WebSocketConnectionView[]
}

export type GatewayResource = "accounts" | "stats" | "settings" | "codex" | "logs" | "websocketConnections"

export type RequestLogRange = "1h" | "24h" | "7d"
export type RequestOutcome = "success" | "rejected" | "upstream_error" | "gateway_error" | "client_cancelled"
export type RequestState = "running" | "completed" | "failed" | "rejected" | "cancelled" | "interrupted"
export type FailureSource = "gateway" | "upstream_http" | "upstream_protocol" | "transport" | "client"
export type FailureStage = "routing" | "authentication" | "handshake" | "sending" | "streaming" | "terminal"
export type IdentityMode = "managed_account" | "client_passthrough"
export interface RequestLogFilters {
  range: RequestLogRange
  status?: "success" | "rejected" | "error" | "cancelled" | "running"
  transport?: "http" | "ws" | "compact" | "models" | "search"
  accountId?: string
  query?: string
  cursor?: string
  page?: number
  limit?: number
}
export interface RequestLogView {
  id: string
  requestId?: string
  route: string
  transport: "http" | "ws" | "compact" | "models" | "search"
  accountId?: string
  accountLabel: string | null
  state: RequestState
  outcome: RequestOutcome | null
  failureSource?: FailureSource
  failureStage?: FailureStage
  httpStatus?: number
  protocolErrorCode?: string
  diagnosticCode?: string
  upstreamRequestId?: string
  diagnosticHeaders?: Record<string, string>
  /** @deprecated */ statusCode?: number
  durationMs?: number
  bytesIn?: number
  bytesOut?: number
  /** @deprecated */ errorCode?: string
  identityMode: IdentityMode
  startedAt: number
  completedAt?: number
  /** @deprecated */ createdAt?: number
}
export interface RequestLogsResponse {
  items: RequestLogView[]
  summary: { requests: number; errors: number; rejected: number; cancelled: number; availabilityRequests: number; availabilityErrors: number; averageDurationMs: number | null }
  timeline: Array<{
    id: string
    createdAt: number
    durationMs: number
    statusCode: number | null
    outcome: RequestOutcome
  }>
  nextCursor: string | null
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}

export type WebSocketConnectionOutcome = "connected" | "rejected" | "failed" | "retired" | "closed"
export interface WebSocketConnectionLogView {
  id: string
  connectionId: string
  accountId?: string
  accountLabel: string | null
  identityMode: IdentityMode
  startedAt: number
  closedAt?: number
  handshakeHttpStatus?: number
  clientCloseCode?: number
  upstreamCloseCode?: number
  closeInitiator?: "client" | "upstream" | "gateway"
  closeReasonCode?: string
  outcome: WebSocketConnectionOutcome
}
export interface WebSocketConnectionLogFilters { range: RequestLogRange; outcome?: WebSocketConnectionOutcome; accountId?: string; query?: string; cursor?: string; page?: number; limit?: number }
export interface WebSocketConnectionLogsResponse { items: WebSocketConnectionLogView[]; nextCursor: string | null; pagination: { page:number; pageSize:number; totalItems:number; totalPages:number } }
export type GatewayActivityEvent = { type:"request_started"|"request_finished"; id:string } | { type:"connection_updated"; connectionId:string }

export interface GatewayService {
  subscribe(
    onInvalidate: (resources: GatewayResource[]) => void,
    onConnectionChange: (connected: boolean) => void,
    onActivity?: (event: GatewayActivityEvent) => void
  ): () => void
  getSnapshot(): Promise<GatewaySnapshot>
  getAccounts(): Promise<AccountsResponse>
  getWebSocketConnections(): Promise<WebSocketConnectionView[]>
  getRequestLogs(filters: RequestLogFilters): Promise<RequestLogsResponse>
  getWebSocketConnectionLogs(filters: WebSocketConnectionLogFilters): Promise<WebSocketConnectionLogsResponse>
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
  openLocalEnvironment(target: "data" | "backup" | "logs"): Promise<void>
}
