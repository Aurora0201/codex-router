export type AuthStatus =
  | "login_pending"
  | "ready"
  | "refreshing"
  | "rate_limited"
  | "relogin_required"
  | "unsupported_fedramp"
  | "disabled"
  | "error";

export type Transport = "http" | "ws" | "compact" | "models";

export interface AccountRecord {
  id: string;
  label: string;
  email: string | null;
  planType: string | null;
  codexHome: string;
  enabled: boolean;
  isDefault: boolean;
  authStatus: AuthStatus;
  fedRamp: boolean;
  primaryUsedPercent: number | null;
  primaryResetsAt: number | null;
  primaryWindowMinutes: number | null;
  secondaryUsedPercent: number | null;
  secondaryResetsAt: number | null;
  secondaryWindowMinutes: number | null;
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
  loadedAt: number;
}

export interface RoutingIdentity {
  routingKey: string;
  threadId: string | null;
  sessionId: string | null;
  previousResponseId: string | null;
  temporary: boolean;
}

export interface SessionRecord {
  routingKey: string;
  routingKeyHash: string;
  accountId: string;
  accountLabel: string;
  threadId: string | null;
  sessionId: string | null;
  transport: Transport;
  status: "active" | "closed" | "expired";
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number | null;
  activeRequests: number;
}

export interface GatewayConfig {
  host: "127.0.0.1" | "::1";
  port: number;
  upstreamBaseUrl: string;
  dataDir: string;
  accountsDir: string;
  databasePath: string;
  webDistDir: string;
  codexCliPath: string;
  codexCliArgs: string[];
  requestBodyLimit: number;
  developerMode: boolean;
}
