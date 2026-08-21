import type { AccountRecord, RateLimitSnapshot } from "../../types.js";
import { GatewayDatabase } from "../../db/database.js";
import { AccountService } from "../../accounts/account-service.js";
import { AccountAuthService } from "../../accounts/account-auth-service.js";
import { AccountUsageService } from "../../accounts/account-usage-service.js";
import { AccountStatusService } from "../../accounts/account-status-service.js";
import { AccountLoginService } from "../../accounts/account-login-service.js";
import { ActiveAccountService } from "../../routing/active-account-service.js";
import type { CsrfGuard } from "../../security/csrf.js";
import type { AdminEventHub } from "./admin-events.js";
import type { CodexProcessMonitor } from "../../codex/codex-process.js";
import type { WebSocketConnectionRegistry } from "../../proxy/websocket-connection-registry.js";
import type { CodexUsageService } from "../../codex/codex-usage-service.js";

const STATUS_STALE_AFTER_MS = 15 * 60_000;

export interface AdminContext {
  config: import("../../types.js").GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
  auth: AccountAuthService;
  usage: AccountUsageService;
  accountStatus: AccountStatusService;
  logins: AccountLoginService;
  activeAccounts: ActiveAccountService;
  csrf: CsrfGuard;
  startedAt: number;
  events: AdminEventHub;
  codexProcess: CodexProcessMonitor;
  websocketConnections: WebSocketConnectionRegistry;
  codexUsage: CodexUsageService;
}

export interface UsageWindowView {
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
}

export interface AccountView {
  id: string;
  chatgptAccountId: string | null;
  email: string | null;
  planType: string | null;
  subscriptionStartedAt: number | null;
  subscriptionExpiresAt: number | null;
  enabled: boolean;
  isActive: boolean;
  authStatus: AccountRecord["authStatus"];
  rateLimitReachedType: string | null;
  usage: { primary: UsageWindowView | null; secondary: UsageWindowView | null };
  lastAuthRefreshAt: number | null;
  lastLimitsRefreshAt: number | null;
  auth: {
    status: AccountRecord["authStatus"];
    mode: string | null;
    checkedAt: number | null;
    lastSuccessfulAt: number | null;
    stale: boolean;
    errorCode: string | null;
  };
  subscription: {
    expiresAt: number | null;
    source: AccountRecord["subscriptionExpirySource"];
  };
  limits: {
    buckets: RateLimitSnapshot["buckets"];
    defaultBucketKey: string | null;
    resetCredits: RateLimitSnapshot["resetCredits"];
    checkedAt: number | null;
  };
}

function storedLimits(account: AccountRecord): RateLimitSnapshot | null {
  if (!account.limitsSnapshotJson) return null;
  try {
    const parsed = JSON.parse(account.limitsSnapshotJson) as RateLimitSnapshot;
    return Array.isArray(parsed.buckets) ? parsed : null;
  } catch {
    return null;
  }
}

export function toAccountView(account: AccountRecord, activeAccountId: string | null): AccountView {
  const snapshot = storedLimits(account);
  const primary = {
    usedPercent: account.primaryUsedPercent,
    resetsAt: account.primaryResetsAt,
    windowDurationMins: account.primaryWindowMinutes,
  };
  const secondary = {
    usedPercent: account.secondaryUsedPercent,
    resetsAt: account.secondaryResetsAt,
    windowDurationMins: account.secondaryWindowMinutes,
  };
  return {
    id: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: account.email,
    planType: account.planType,
    subscriptionStartedAt: account.subscriptionStartedAt,
    subscriptionExpiresAt: account.subscriptionExpiresAt,
    enabled: account.enabled,
    isActive: account.id === activeAccountId,
    authStatus: account.authStatus,
    rateLimitReachedType: account.rateLimitReachedType,
    usage: { primary, secondary },
    lastAuthRefreshAt: account.lastAuthRefreshAt,
    lastLimitsRefreshAt: account.lastLimitsRefreshAt,
    auth: {
      status: account.authStatus,
      mode: account.authMode,
      checkedAt: account.authCheckedAt,
      lastSuccessfulAt: account.authLastSuccessfulAt,
      stale: account.authLastSuccessfulAt === null || Date.now() - account.authLastSuccessfulAt > STATUS_STALE_AFTER_MS,
      errorCode: account.authErrorCode,
    },
    subscription: {
      expiresAt: account.subscriptionExpiresAt,
      source: account.subscriptionExpirySource,
    },
    limits: {
      buckets: snapshot?.buckets ?? [],
      defaultBucketKey: snapshot?.defaultBucketKey ?? null,
      resetCredits: snapshot?.resetCredits ?? null,
      checkedAt: account.lastLimitsRefreshAt,
    },
  };
}
