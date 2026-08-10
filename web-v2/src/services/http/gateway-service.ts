import type {
  AccountView,
  AccountsResponse,
  CodexStatusView,
  GatewayService,
  GatewayResource,
  HealthView,
  LoginSessionView,
  SettingsView,
  StatsView,
} from "@/services/contracts"

type ErrorPayload = { error?: string }

export function createHttpGatewayService(): GatewayService {
  let csrfToken = ""

  async function parseResponse<T>(response: Response): Promise<T> {
    if (response.ok) {
      if (response.status === 204) return undefined as T
      return response.json() as Promise<T>
    }

    const payload = (await response.json().catch(() => ({}))) as ErrorPayload
    throw new Error(payload.error ?? `request_failed_${response.status}`)
  }

  async function fetchHealth(): Promise<HealthView> {
    const response = await fetch("/api/health", { credentials: "same-origin" })
    const health = await parseResponse<HealthView>(response)
    csrfToken = health.csrfToken
    return health
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    retryCsrf = true
  ): Promise<T> {
    const method = init.method ?? "GET"
    const mutating = method !== "GET" && method !== "HEAD"
    if (mutating && !csrfToken) await fetchHealth()

    const response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(mutating && csrfToken ? { "x-csrf-token": csrfToken } : {}),
        ...init.headers,
      },
    })

    if (response.status === 403 && retryCsrf) {
      const payload = (await response
        .clone()
        .json()
        .catch(() => ({}))) as ErrorPayload
      if (payload.error === "csrf_validation_failed") {
        csrfToken = ""
        await fetchHealth()
        return request<T>(path, init, false)
      }
    }

    return parseResponse<T>(response)
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    body: JSON.stringify(body),
  })
  const accountPath = (id: string) => `/api/accounts/${encodeURIComponent(id)}`

  return {
    subscribe(onInvalidate, onConnectionChange) {
      const source = new EventSource("/api/events")
      source.onopen = () => onConnectionChange(true)
      source.onerror = () => onConnectionChange(false)
      source.addEventListener("invalidate", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            resources?: GatewayResource[]
          }
          if (Array.isArray(payload.resources)) onInvalidate(payload.resources)
        } catch {
          // Ignore malformed notifications; the fallback snapshot will recover.
        }
      })
      return () => source.close()
    },
    async getSnapshot() {
      const health = await fetchHealth()
      const [stats, accounts, settings, codex] = await Promise.all([
        request<StatsView>("/api/stats"),
        request<AccountsResponse>("/api/accounts"),
        request<SettingsView>("/api/settings"),
        request<CodexStatusView>("/api/codex/status"),
      ])
      return { health, stats, accounts, settings, codex }
    },
    getAccounts: () => request<AccountsResponse>("/api/accounts"),
    setActiveAccount: (id) =>
      request<AccountView>("/api/active-account", json("PUT", { id })),
    clearActiveAccount: () =>
      request<void>("/api/active-account", { method: "DELETE" }),
    updateAccount: (id, values) =>
      request<AccountView>(accountPath(id), json("PATCH", values)),
    removeAccount: (id) => request<void>(accountPath(id), { method: "DELETE" }),
    refreshAccountAuth: (id) =>
      request<AccountView>(`${accountPath(id)}/refresh-auth`, json("POST", {})),
    refreshAccountLimits: (id) =>
      request<AccountView>(
        `${accountPath(id)}/refresh-limits`,
        json("POST", {})
      ),
    startLogin: () =>
      request<LoginSessionView>("/api/account-logins", json("POST", {})),
    getLoginStatus: (loginId) =>
      request<LoginSessionView>(
        `/api/account-logins/${encodeURIComponent(loginId)}`
      ),
    cancelLogin: (loginId) =>
      request<void>(`/api/account-logins/${encodeURIComponent(loginId)}`, {
        method: "DELETE",
      }),
    saveSettings: (values) =>
      request<SettingsView>("/api/settings", json("PATCH", values)),
    async applyCodexConfig() {
      await request<unknown>("/api/codex/apply-config", json("POST", {}))
      return request<CodexStatusView>("/api/codex/status")
    },
    async restoreCodexConfig() {
      await request<unknown>("/api/codex/restore-config", json("POST", {}))
      return request<CodexStatusView>("/api/codex/status")
    },
    restartCodex: () =>
      request<{ running: boolean; codexPath: string | null }>(
        "/api/codex/restart",
        json("POST", {})
      ),
  }
}
