import { describe, expect, it } from "vitest"
import { createMockGatewayService } from "./gateway-service"

describe("mock gateway service", () => {
  it("supports manual active account selection and clearing", async () => {
    const service = createMockGatewayService()
    const initial = await service.getAccounts()
    const ready = initial.accounts.find(
      (account) => account.authStatus === "ready" && !account.isActive
    )!
    await service.setActiveAccount(ready.id)
    expect((await service.getAccounts()).activeAccountId).toBe(ready.id)
    await service.clearActiveAccount()
    expect((await service.getAccounts()).activeAccountId).toBeNull()
  })

  it("isolates scenario control from the gateway contract", async () => {
    const service = createMockGatewayService("empty")
    expect((await service.getSnapshot()).accounts.accounts).toHaveLength(0)
    service.setScenario("offline")
    await expect(service.getSnapshot()).rejects.toThrow("mock_gateway_offline")
  })

  it("completes the deterministic OAuth mock lifecycle", async () => {
    const service = createMockGatewayService()
    const login = await service.startLogin()
    expect(login.status).toBe("waiting")
    await service.getLoginStatus(login.loginId)
    await service.getLoginStatus(login.loginId)
    expect((await service.getLoginStatus(login.loginId)).status).toBe(
      "complete"
    )
  })

  it("saves supported settings and transitions Codex state", async () => {
    const service = createMockGatewayService()
    expect(
      (
        await service.saveSettings({
          requestMetadataLogging: false,
          theme: "dark",
        })
      ).theme
    ).toBe("dark")
    await service.restoreCodexConfig()
    expect((await service.getSnapshot()).codex.applied).toBe(false)
    await service.applyCodexConfig()
    expect((await service.getSnapshot()).codex.applied).toBe(true)
  })
})
