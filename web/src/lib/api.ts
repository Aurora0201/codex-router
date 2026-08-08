export interface Account {
  id: string; label: string; email: string | null; planType: string | null; enabled: boolean; isDefault: boolean;
  authStatus: string; fedRamp: boolean; primaryUsedPercent: number | null; primaryResetsAt: number | null;
  primaryWindowMinutes: number | null; secondaryUsedPercent: number | null; secondaryResetsAt: number | null;
  secondaryWindowMinutes: number | null; lastAuthRefreshAt: number | null; lastLimitsRefreshAt: number | null;
}
export interface Session {
  routingKey: string; routingKeyHash: string; accountId: string; accountLabel: string; threadId: string | null;
  sessionId: string | null; transport: string; status: string; createdAt: number; lastSeenAt: number; activeRequests: number;
}
export interface Settings {
  gatewayAddress: string; gatewayPort: number; upstream: string; requestMetadataLogging: boolean;
  promptLogging: false; theme: "system" | "light" | "dark";
}
export interface Stats {
  uptimeSeconds: number; activeSessions: number; activeWebSockets: number; requestsToday: number; errorsToday: number; accountsReady: number;
}
export interface Health { status: string; csrfToken: string; accounts: number; version: string; }
export interface Login { loginId: string; accountId: string; authUrl: string; status: "waiting" | "complete" | "failed" | "cancelled"; error?: string; }

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
  accounts: () => request<Account[]>("/api/accounts"),
  sessions: () => request<Session[]>("/api/sessions"),
  settings: () => request<Settings>("/api/settings"),
  stats: () => request<Stats>("/api/stats"),
  startLogin: (label: string) => request<Login>("/api/accounts/login", { method: "POST", body: JSON.stringify({ label }) }),
  loginStatus: (id: string) => request<Login>(`/api/accounts/login/${encodeURIComponent(id)}/status`),
  cancelLogin: (id: string) => request<void>(`/api/accounts/login/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateAccount: (id: string, values: { label?: string; enabled?: boolean }) => request<Account>(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(values) }),
  removeAccount: (id: string) => request<void>(`/api/accounts/${id}`, { method: "DELETE" }),
  setDefault: (id: string) => request<Account>(`/api/accounts/${id}/set-default`, { method: "POST", body: "{}" }),
  refreshAuth: (id: string) => request<Account>(`/api/accounts/${id}/refresh-auth`, { method: "POST", body: "{}" }),
  refreshLimits: (id: string) => request<Account>(`/api/accounts/${id}/refresh-limits`, { method: "POST", body: "{}" }),
  releaseSession: (key: string) => request<void>(`/api/sessions/${encodeURIComponent(key)}/release`, { method: "POST", body: "{}" }),
  updateSettings: (values: Partial<Settings>) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(values) }),
};
