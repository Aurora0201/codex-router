import { afterEach, describe, expect, it, vi } from "vitest"

import { createHttpGatewayService } from "./gateway-service"

const health = {
  status: "ok",
  upstream: "configured",
  accounts: 1,
  csrfToken: "csrf-1",
  version: "0.2.0",
}
const accounts = { activeAccountId: null, accounts: [] }
const stats = {
  uptimeSeconds: 10,
  requestsToday: 2,
  errorsToday: 0,
  accountsReady: 0,
}
const settings = {
  gatewayAddress: "127.0.0.1",
  gatewayPort: 8317,
  upstream: "https://chatgpt.com/backend-api/codex",
  requestMetadataLogging: true,
  logLevel: "info",
  theme: "system",
}
const codex = {
  configPath: "config.toml",
  openaiBaseUrl: null,
  gatewayBaseUrl: "http://127.0.0.1:8317/backend-api/codex",
  applied: false,
  modelCatalogJson: null,
  hasBackup: false,
  configExists: true,
  codexRunning: false,
}
const websocketConnections = [
  { connectionId: "connection-1", state: "idle", connectedAt: 1000 },
]
const account = {
  id: "account/one",
  chatgptAccountId: "chatgpt-account",
  email: null,
  planType: null,
  enabled: true,
  isActive: false,
  authStatus: "ready",
  rateLimitReachedType: null,
  usage: { primary: null, secondary: null },
  lastAuthRefreshAt: null,
  lastLimitsRefreshAt: null,
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("HTTP GatewayService", () => {
  it("loads health first and aggregates the real admin snapshot", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(jsonResponse(stats))
      .mockResolvedValueOnce(jsonResponse(accounts))
      .mockResolvedValueOnce(jsonResponse(settings))
      .mockResolvedValueOnce(jsonResponse(codex))
      .mockResolvedValueOnce(jsonResponse(websocketConnections))
    vi.stubGlobal("fetch", fetchMock)

    await expect(createHttpGatewayService().getSnapshot()).resolves.toEqual({
      health,
      stats,
      accounts,
      settings,
      codex,
      websocketConnections,
    })
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/health",
      "/api/stats",
      "/api/accounts",
      "/api/settings",
      "/api/codex/status",
      "/api/websocket-connections",
    ])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
    })
  })

  it("maps account and login operations with encoded ids and CSRF", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === "/api/health") return jsonResponse(health)
      if (
        String(path).includes("account-logins") &&
        String(path).endsWith("login%2Fone")
      ) {
        return jsonResponse({
          loginId: "login/one",
          authUrl: "https://auth.openai.test",
          status: "waiting",
        })
      }
      if (String(path).includes("account-logins")) {
        return jsonResponse({
          loginId: "login/one",
          authUrl: "https://auth.openai.test",
          status: "waiting",
        })
      }
      if (path === "/api/accounts") return jsonResponse(accounts)
      if (String(path).includes("accounts/account%2Fone"))
        return jsonResponse(account)
      if (path === "/api/active-account") return jsonResponse(account)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const service = createHttpGatewayService()

    await service.getAccounts()
    await service.setActiveAccount("account/one")
    await service.clearActiveAccount()
    await service.updateAccount("account/one", { enabled: false })
    await service.updateAccount("account/one", {
      subscriptionStartedAt: 1_786_089_600_000,
    })
    await service.removeAccount("account/one")
    await service.refreshAccountAuth("account/one")
    await service.refreshAccountLimits("account/one")
    await service.startLogin()
    await service.getLoginStatus("login/one")
    await service.cancelLogin("login/one")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/active-account",
      expect.objectContaining({
        method: "PUT",
        body: '{"id":"account/one"}',
        credentials: "same-origin",
        headers: expect.objectContaining({ "x-csrf-token": "csrf-1" }),
      })
    )
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/api/accounts/account%2Fone",
        "/api/accounts/account%2Fone/refresh-auth",
        "/api/accounts/account%2Fone/refresh-limits",
        "/api/account-logins/login%2Fone",
      ])
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/accounts/account%2Fone",
      expect.objectContaining({
        method: "PATCH",
        body: '{"subscriptionStartedAt":1786089600000}',
      })
    )
  })

  it("maps settings and Codex actions and refreshes full Codex status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === "/api/health") return jsonResponse(health)
      if (path === "/api/settings") return jsonResponse(settings)
      if (path === "/api/codex/status") return jsonResponse(codex)
      if (path === "/api/codex/restart") {
        return jsonResponse({ running: true, codexPath: "codex.exe" })
      }
      return jsonResponse({ applied: true })
    })
    vi.stubGlobal("fetch", fetchMock)
    const service = createHttpGatewayService()

    await service.saveSettings({
      requestMetadataLogging: true,
      theme: "dark",
    })
    await expect(service.applyCodexConfig()).resolves.toEqual(codex)
    await expect(service.restoreCodexConfig()).resolves.toEqual(codex)
    await expect(service.restartCodex()).resolves.toEqual({
      running: true,
      codexPath: "codex.exe",
    })

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/api/settings",
        "/api/codex/apply-config",
        "/api/codex/restore-config",
        "/api/codex/restart",
      ])
    )
    expect(
      fetchMock.mock.calls.filter(([path]) => path === "/api/codex/status")
    ).toHaveLength(2)
  })

  it("refreshes a stale CSRF token once and preserves backend errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(health))
      .mockResolvedValueOnce(
        jsonResponse({ error: "csrf_validation_failed" }, 403)
      )
      .mockResolvedValueOnce(jsonResponse({ ...health, csrfToken: "csrf-2" }))
      .mockResolvedValueOnce(jsonResponse(settings))
    vi.stubGlobal("fetch", fetchMock)
    const service = createHttpGatewayService()

    await expect(
      service.saveSettings({ requestMetadataLogging: true, theme: "light" })
    ).resolves.toEqual(settings)
    expect(fetchMock.mock.calls[3][1]?.headers).toEqual(
      expect.objectContaining({ "x-csrf-token": "csrf-2" })
    )

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "account_not_found" }, 404)
    )
    await expect(service.getAccounts()).rejects.toThrow("account_not_found")
  })

  it("maps request-log filters and preserves timeline metadata", async () => {
    const payload = {
      items: [],
      summary: {
        requests: 1,
        errors: 1,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: 1,
        availabilityErrors: 1,
        averageDurationMs: 42,
      },
      timeline: [
        {
          id: "log-1",
          createdAt: 1000,
          durationMs: 42,
          statusCode: 500,
          outcome: "upstream_error",
        },
      ],
      nextCursor: null,
      pagination: { page: 3, pageSize: 50, totalItems: 121, totalPages: 3 },
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      createHttpGatewayService().getRequestLogs({
        range: "24h",
        status: "error",
        transport: "http",
        accountId: "account/one",
        query: "upstream error",
        page: 3,
        limit: 50,
      })
    ).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/request-logs?range=24h&status=error&transport=http&accountId=account%2Fone&q=upstream+error&page=3&limit=50",
      expect.objectContaining({ credentials: "same-origin" })
    )
  })

  it("maps separated request evidence and connection diagnostic filters", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({
        items: [],
        summary: { connections: 0, failures: 0, retired: 0 },
        nextCursor: null,
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const service = createHttpGatewayService()
    await service.getRequestLogs({
      range: "24h",
      from: 100,
      to: 200,
      state: "failed",
      outcome: "upstream_error",
      failureSource: "transport",
      failureStage: "streaming",
      httpStatus: 502,
      protocolErrorCode: "server_error",
      diagnosticCode: "stream_closed",
      page: 1,
      limit: 20,
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "from=100&to=200&state=failed&outcome=upstream_error&failureSource=transport&failureStage=streaming&httpStatus=502&protocolErrorCode=server_error&diagnosticCode=stream_closed"
    )
    await service.getWebSocketConnectionLogs({
      range: "7d",
      from: 300,
      to: 400,
      outcome: "failed",
      closeInitiator: "upstream",
      handshakeHttpStatus: 101,
      clientCloseCode: 1000,
      upstreamCloseCode: 1011,
      page: 2,
      limit: 20,
    })
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "from=300&to=400&outcome=failed&closeInitiator=upstream&handshakeHttpStatus=101&clientCloseCode=1000&upstreamCloseCode=1011&page=2&limit=20"
    )
  })
})
