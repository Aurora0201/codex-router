export type AuthStatus =
  | "login_pending"
  | "checking"
  | "ready"
  | "refreshing"
  | "rate_limited"
  | "relogin_required"
  | "unsupported_fedramp"
  | "disabled"
  | "error"

export type BillingCadence = "monthly" | "annual"

export interface UsageWindowView {
  usedPercent: number | null
  resetsAt: number | null
  windowDurationMins: number | null
}

export interface CreditsView {
  hasCredits: boolean
  unlimited: boolean
  balance: string | null
}

export interface SpendControlLimitView {
  limit: string
  used: string
  remainingPercent: number
  resetsAt: number
}

export interface RateLimitBucketView {
  key: string
  limitId: string | null
  limitName: string | null
  primary: UsageWindowView | null
  secondary: UsageWindowView | null
  credits: CreditsView | null
  individualLimit: SpendControlLimitView | null
  spendControlReached: boolean | null
  planType: string | null
  rateLimitReachedType: string | null
}

export interface RateLimitResetCreditView {
  id: string
  resetType: string
  status: string
  grantedAt: number
  expiresAt: number | null
  title: string | null
  description: string | null
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
  auth: {
    status: AuthStatus
    mode: string | null
    checkedAt: number | null
    lastSuccessfulAt: number | null
    stale: boolean
    errorCode: string | null
  }
  billing: {
    anchorAt: number | null
    cadence: BillingCadence | null
  }
  limits: {
    buckets: RateLimitBucketView[]
    defaultBucketKey: string | null
    resetCredits: {
      availableCount: number
      credits: RateLimitResetCreditView[] | null
    } | null
    checkedAt: number | null
  }
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

export type AllBelowBehaviour = "highest" | "stay" | "pause"

/** Which quota window the switch decision reads. */
export type SwitchBasis = "weekly" | "short" | "both"

export interface AutoSwitchSettingsView {
  enabled: boolean
  switchOn: SwitchBasis
  /** The long (weekly) window's threshold. */
  thresholdPercent: number
  /** The 5-hour window's own, tighter threshold. */
  shortThresholdPercent: number
  minDwellMs: number
  switchBackToHigherPriority: boolean
  onAllBelow: AllBelowBehaviour
  triggerOn429: boolean
  triggerOnAuthFailure: boolean
}

export type SwitchReason =
  | "quota_below_threshold"
  | "upstream_rate_limited"
  | "account_unavailable"
  | "higher_priority_recovered"

export interface SwitchLogEntryView {
  id: string
  switchedAt: number
  fromAccountId: string | null
  toAccountId: string | null
  reason: SwitchReason
  evidence: Record<string, unknown> | null
}

export interface AutoSwitchView {
  settings: AutoSwitchSettingsView
  /** The order the gateway would walk, so the console never re-derives it. */
  candidateIds: string[]
  /** Switching is on and every account in the rotation is below its threshold. */
  stalled: boolean
  recent: SwitchLogEntryView[]
}

export interface WarmupSettingsView {
  /** The gateway warming accounts by itself, which is spending without asking. */
  auto: boolean
  /** null means "whatever this account's own default model is". */
  model: string | null
  /** How hard the model thinks; null leaves the model's own default. */
  effort: string | null
  message: string
  cooldownMs: number
  dailyLimit: number
}

export interface WarmupModelView {
  id: string
  displayName: string
  isDefault: boolean
  /** Which efforts this model takes, in the catalog's own order. */
  efforts: { id: string; description: string }[]
  defaultEffort: string | null
}

export type WarmupSkipReason =
  "window_running" | "cooldown" | "daily_limit" | "not_enrolled" | "not_ready"

export type WarmupOutcome = "warmed" | "skipped" | "failed"

export interface WarmupLogEntryView {
  id: string
  startedAt: number
  accountId: string
  trigger: "manual" | "auto"
  outcome: WarmupOutcome
  model: string | null
  durationMs: number | null
  /** A classification, never the upstream's own words. */
  errorCode: string | null
  windowBeforeResetsAt: number | null
  windowAfterResetsAt: number | null
}

export interface WarmupAccountView {
  id: string
  enrolled: boolean
  /** Enabled and authenticated, so warm-up may touch it at all. */
  eligible: boolean
  windowResetsAt: number | null
  /** Already counting, so warming it would buy nothing. */
  windowRunning: boolean
}

export interface WarmupProgressView {
  running: boolean
  total: number
  done: number
  accountId: string | null
}

export interface WarmupView {
  settings: WarmupSettingsView
  progress: WarmupProgressView
  accounts: WarmupAccountView[]
  recent: WarmupLogEntryView[]
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
  "connecting" | "idle" | "transmitting" | "retiring"
export type WebSocketActivityKind = "response" | "compaction" | "prewarm"

export interface WebSocketConnectionView {
  connectionId: string
  state: WebSocketConnectionState
  connectedAt: number
  activeRequestId?: string
  sessionId?: string
  threadId?: string
  turnId?: string
  activityKind?: WebSocketActivityKind
}

export interface GatewaySnapshot {
  health: HealthView
  stats: StatsView
  accounts: AccountsResponse
  settings: SettingsView
  codex: CodexStatusView
  websocketConnections: WebSocketConnectionView[]
}

export type GatewayResource =
  | "accounts"
  | "stats"
  | "settings"
  | "codex"
  | "logs"
  | "websocketConnections"
  | "usage"
  | "warmup"

export type CodexUsageRange = "1d" | "7d" | "14d" | "30d" | "90d" | "all"
export interface CodexUsageFilters {
  range: CodexUsageRange
  model?: string
  project?: string
}
export interface CodexUsageDashboard {
  status: "scanning" | "ready" | "partial"
  scope: "local_codex_home"
  generatedAt: number
  timezone: string
  coverage: {
    firstEventAt: number | null
    lastEventAt: number | null
    rollouts: number
    sourceRollouts: number
    retainedRollouts: number
    lastScannedAt: number | null
    lastRetentionAt: number | null
    parseWarnings: number
    scan: {
      complete: boolean
      lastSuccessfulAt: number | null
      pendingMissingRollouts: number
    }
    retention: { pendingAuditEvents: number; lastVerifiedAt: number | null }
    backup: {
      status: "ready" | "pending" | "failed" | "unavailable"
      lastSuccessfulAt: number | null
      generations: number
      lastRecoveryAt: number | null
    }
  }
  summary: {
    totalTokens: number
    todayTokens: number
    dailyAverage: number
    inputTokens: number
    cachedInputTokens: number
    uncachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    cacheHitPercent: number
    sessions: number
    tasksStarted: number
    tasksCompleted: number
    abortedTurns: number
    compactions: number
    completionPercent: number
    tokensPerCompletedTask: number
  }
  daily: Array<{
    date: string
    inputTokens: number
    cachedInputTokens: number
    uncachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
    sessions: number
    tasks: number
    rollingAverage7d: number
    isPartial: boolean
  }>
  dailyModels: Array<{
    date: string
    totalTokens: number
    isPartial: boolean
    models: Array<{ key: string; label: string; totalTokens: number }>
  }>
  models: Array<{
    key: string
    label: string
    totalTokens: number
    tasks: number
    share: number
  }>
  projects: Array<{
    key: string
    label: string
    totalTokens: number
    tasks: number
    share: number
  }>
  heatmap: Array<{ date: string; hour: number; totalTokens: number }>
  filters: { models: string[]; projects: Array<{ key: string; label: string }> }
}

export type RequestLogRange = "1h" | "24h" | "7d"
export type RequestOutcome =
  | "success"
  | "rejected"
  | "upstream_error"
  | "gateway_error"
  | "client_cancelled"
export type RequestState =
  "running" | "completed" | "failed" | "rejected" | "cancelled" | "interrupted"
export type FailureSource =
  "gateway" | "upstream_http" | "upstream_protocol" | "transport" | "client"
export type FailureStage =
  | "routing"
  | "authentication"
  | "handshake"
  | "sending"
  | "streaming"
  | "terminal"
export type IdentityMode = "managed_account" | "client_passthrough"
export interface RequestLogFilters {
  range: RequestLogRange
  from?: number
  to?: number
  status?: "success" | "rejected" | "error" | "cancelled" | "running"
  state?: RequestState
  outcome?: RequestOutcome
  failureSource?: FailureSource
  failureStage?: FailureStage
  httpStatus?: number
  protocolErrorCode?: string
  diagnosticCode?: string
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
  transportErrorChain?: Array<{ name?: string; code?: string }>
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
  summary: {
    requests: number
    errors: number
    rejected: number
    cancelled: number
    availabilityRequests: number
    availabilityErrors: number
    averageDurationMs: number | null
  }
  /**
   * The timeline is a capped sample of recent requests, so anything that has
   * to be counted or shaped over the whole window is aggregated server-side
   * instead: `histogram` covers the full range in fixed-duration buckets.
   */
  timeline: Array<{
    id: string
    createdAt: number
    durationMs: number
    statusCode: number | null
    outcome: RequestOutcome
  }>
  histogram: Array<{
    startedAt: number
    endedAt: number
    requests: number
    errors: number
    rejected: number
    cancelled: number
  }>
  failureSources: Array<{ source: FailureSource; count: number }>
  diagnosticCodes: Array<{ code: string; count: number }>
  nextCursor: string | null
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}

export type WebSocketConnectionOutcome =
  "connected" | "rejected" | "failed" | "retired" | "closed"
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
export interface WebSocketConnectionLogFilters {
  range: RequestLogRange
  from?: number
  to?: number
  outcome?: WebSocketConnectionOutcome
  accountId?: string
  query?: string
  closeInitiator?: "client" | "upstream" | "gateway"
  handshakeHttpStatus?: number
  clientCloseCode?: number
  upstreamCloseCode?: number
  cursor?: string
  page?: number
  limit?: number
}
export interface WebSocketConnectionLogsResponse {
  items: WebSocketConnectionLogView[]
  summary: { connections: number; failures: number; retired: number }
  histogram: Array<{
    startedAt: number
    endedAt: number
    connections: number
    failures: number
    retired: number
  }>
  nextCursor: string | null
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
}
export type GatewayActivityEvent =
  | { type: "request_started" | "request_finished"; id: string }
  | { type: "connection_updated"; connectionId: string }

export interface GatewayService {
  subscribe(
    onInvalidate: (resources: GatewayResource[]) => void,
    onConnectionChange: (connected: boolean) => void,
    onActivity?: (event: GatewayActivityEvent) => void
  ): () => void
  getSnapshot(): Promise<GatewaySnapshot>
  getAccounts(): Promise<AccountsResponse>
  getWebSocketConnections(): Promise<WebSocketConnectionView[]>
  getCodexUsage(filters: CodexUsageFilters): Promise<CodexUsageDashboard>
  getRequestLogs(filters: RequestLogFilters): Promise<RequestLogsResponse>
  getWebSocketConnectionLogs(
    filters: WebSocketConnectionLogFilters
  ): Promise<WebSocketConnectionLogsResponse>
  setActiveAccount(id: string): Promise<AccountView>
  clearActiveAccount(): Promise<void>
  updateAccount(
    id: string,
    values: {
      enabled?: boolean
      billingAnchorAt?: number | null
      billingCadence?: BillingCadence | null
    }
  ): Promise<AccountView>
  removeAccount(id: string): Promise<void>
  refreshAccountAuth(id: string): Promise<AccountView>
  refreshAccountLimits(id: string): Promise<AccountView>
  refreshAllAccountStatus(): Promise<{ started: boolean }>
  consumeAccountResetCredit(
    id: string,
    input: { idempotencyKey: string; creditId?: string }
  ): Promise<{
    outcome: "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit"
    account: AccountView
  }>
  startLogin(): Promise<LoginSessionView>
  getLoginStatus(loginId: string): Promise<LoginSessionView>
  cancelLogin(loginId: string): Promise<void>
  getAutoSwitch(): Promise<AutoSwitchView>
  saveAutoSwitch(
    values: Partial<AutoSwitchSettingsView>
  ): Promise<AutoSwitchSettingsView>
  saveAutoSwitchPriority(input: {
    order?: string[]
    enrolled?: Record<string, boolean>
  }): Promise<{ candidateIds: string[] }>
  getWarmup(): Promise<WarmupView>
  getWarmupModels(): Promise<{ models: WarmupModelView[] }>
  saveWarmup(values: Partial<WarmupSettingsView>): Promise<WarmupSettingsView>
  saveWarmupEnrollment(input: {
    enrolled: Record<string, boolean>
  }): Promise<{ enrolled: Record<string, boolean> }>
  runWarmup(input?: {
    force?: boolean
    accountIds?: string[]
  }): Promise<{ started: boolean; total: number }>
  saveSettings(
    values: Partial<
      Pick<SettingsView, "requestMetadataLogging" | "theme" | "logLevel">
    >
  ): Promise<SettingsView>
  applyCodexConfig(): Promise<CodexStatusView>
  restoreCodexConfig(): Promise<CodexStatusView>
  restartCodex(): Promise<{ running: boolean; codexPath: string | null }>
}
