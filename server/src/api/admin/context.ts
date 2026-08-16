import type { AccountRecord } from "../../types.js";
import { GatewayDatabase } from "../../db/database.js";
import { AccountService } from "../../accounts/account-service.js";
import { AccountAuthService } from "../../accounts/account-auth-service.js";
import { AccountUsageService } from "../../accounts/account-usage-service.js";
import { AccountLoginService } from "../../accounts/account-login-service.js";
import { ActiveAccountService } from "../../routing/active-account-service.js";
import type { CsrfGuard } from "../../security/csrf.js";
import type { AdminEventHub } from "./admin-events.js";
import type { CodexProcessMonitor } from "../../codex/codex-process.js";
import type { WebSocketConnectionRegistry } from "../../proxy/websocket-connection-registry.js";

export interface AdminContext {
  config: import("../../types.js").GatewayConfig;
  database: GatewayDatabase;
  accounts: AccountService;
  auth: AccountAuthService;
  usage: AccountUsageService;
  logins: AccountLoginService;
  activeAccounts: ActiveAccountService;
  csrf: CsrfGuard;
  startedAt: number;
  events: AdminEventHub;
  codexProcess: CodexProcessMonitor;
  websocketConnections: WebSocketConnectionRegistry;
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
}

export function toAccountView(account: AccountRecord, activeAccountId: string | null): AccountView {
  return {
    id: account.id,
    chatgptAccountId: account.chatgptAccountId,
    email: account.email,
    planType: account.planType,
    subscriptionStartedAt: account.subscriptionStartedAt,
    subscriptionExpiresAt: account.subscriptionStartedAt === null
      ? null
      : account.subscriptionStartedAt + 30 * 24 * 60 * 60_000,
    enabled: account.enabled,
    isActive: account.id === activeAccountId,
    authStatus: account.authStatus,
    rateLimitReachedType: account.rateLimitReachedType,
    usage: {
      primary: {
        usedPercent: account.primaryUsedPercent,
        resetsAt: account.primaryResetsAt,
        windowDurationMins: account.primaryWindowMinutes,
      },
      secondary: {
        usedPercent: account.secondaryUsedPercent,
        resetsAt: account.secondaryResetsAt,
        windowDurationMins: account.secondaryWindowMinutes,
      },
    },
    lastAuthRefreshAt: account.lastAuthRefreshAt,
    lastLimitsRefreshAt: account.lastLimitsRefreshAt,
  };
}
