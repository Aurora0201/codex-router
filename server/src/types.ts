export type AuthStatus =
  | "login_pending"
  | "ready"
  | "refreshing"
  | "rate_limited"
  | "relogin_required"
  | "unsupported_fedramp"
  | "disabled"
  | "error";

export type Transport = "http" | "ws" | "compact" | "models" | "search";
export type RequestOutcome = "success" | "rejected" | "upstream_error" | "gateway_error" | "client_cancelled";
export type RequestScope = "request" | "connection";

export interface AccountRecord {
  id: string;
  chatgptAccountId: string | null;
  email: string | null;
  planType: string | null;
  codexHome: string;
  enabled: boolean;
  authStatus: AuthStatus;
  fedRamp: boolean;
  primaryUsedPercent: number | null;
  primaryResetsAt: number | null;
  primaryWindowMinutes: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetsAt: number | null;
  secondaryWindowMinutes: number | null;
  rateLimitReachedType: string | null;
  lastAuthRefreshAt: number | null;
  lastLimitsRefreshAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CredentialSnapshot {
  accessToken: string;
  accountId: string;
  fedRamp: boolean;
  email: string | null;
  planType: string | null;
  loadedAt: number;
}

export interface RateLimitWindow {
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  rateLimitReachedType: string | null;
  loadedAt: number;
}

export interface GatewayConfig {
  host: "127.0.0.1" | "::1";
  port: number;
  upstreamBaseUrl: string;
  dataDir: string;
  accountsDir: string;
  loginStagingDir: string;
  databasePath: string;
  logFilePath: string | null;
  webDistDir: string;
  codexCliPath: string;
  codexCliArgs: string[];
  requestBodyLimit: number;
  developerMode: boolean;
}
