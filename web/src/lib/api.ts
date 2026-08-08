export interface UsageWindowView {
  usedPercent: number | null;
  resetsAt: number | null;
  windowDurationMins: number | null;
}
export interface Account {
  id: string;
  chatgptAccountId: string | null;
  email: string | null;
  planType: string | null;
  enabled: boolean;
  isActive: boolean;
  authStatus: string;
  rateLimitReachedType: string | null;
  usage: { primary: UsageWindowView | null; secondary: UsageWindowView | null };
  lastAuthRefreshAt: number | null;
  lastLimitsRefreshAt: number | null;
}
export interface AccountsResponse {
  activeAccountId: string | null;
  accounts: Account[];
}
export interface Settings {
  gatewayAddress: string;
  gatewayPort: number;
  upstream: string;
  requestMetadataLogging: boolean;
  promptLogging: false;
  theme: "system" | "light" | "dark";
}
export interface Stats {
  uptimeSeconds: number;
  requestsToday: number;
  errorsToday: number;
  accountsReady: number;
}
export interface Health {
  status: string;
  csrfToken: string;
  accounts: number;
  version: string;
}
export interface Login {
  loginId: string;
  authUrl: string;
  status: "waiting" | "complete" | "failed" | "cancelled";
  error?: string;
  createdAccountId?: string;
}

export interface CodexStatus {
  configPath: string;
  openaiBaseUrl: string | null;
  gatewayBaseUrl: string;
  applied: boolean;
  modelCatalogJson: string | null;
  hasBackup: boolean;
  configExists: boolean;
  codexRunning: boolean;
}

let csrfToken = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(csrfToken && init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  health: async () => { const health = await request<Health>("/api/health"); csrfToken = health.csrfToken; return health; },
  accounts: () => request<AccountsResponse>("/api/accounts"),
  settings: () => request<Settings>("/api/settings"),
  stats: () => request<Stats>("/api/stats"),
  startLogin: () => request<Login>("/api/account-logins", { method: "POST", body: "{}" }),
  loginStatus: (id: string) => request<Login>(`/api/account-logins/${encodeURIComponent(id)}`),
  cancelLogin: (id: string) => request<void>(`/api/account-logins/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateAccount: (id: string, values: { enabled: boolean }) => request<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
  removeAccount: (id: string) => request<void>(`/api/accounts/${id}`, { method: "DELETE" }),
  setActive: (id: string) => request<Account>("/api/active-account", { method: "PUT", body: JSON.stringify({ id }) }),
  clearActive: () => request<void>("/api/active-account", { method: "DELETE" }),
  refreshAuth: (id: string) => request<Account>(`/api/accounts/${id}/refresh-auth`, { method: "POST", body: "{}" }),
  refreshLimits: (id: string) => request<Account>(`/api/accounts/${id}/refresh-limits`, { method: "POST", body: "{}" }),
  updateSettings: (values: Partial<Settings>) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(values) }),
  codexStatus: () => request<CodexStatus>("/api/codex/status"),
  codexApplyConfig: () => request<CodexStatus>("/api/codex/apply-config", { method: "POST", body: "{}" }),
  codexRestoreConfig: () => request<CodexStatus>("/api/codex/restore-config", { method: "POST", body: "{}" }),
  codexRestart: () => request<{ running: boolean; codexPath: string | null }>("/api/codex/restart", { method: "POST", body: "{}" }),
};
