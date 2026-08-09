import { beforeEach, describe, expect, it } from "vitest"
import { mockGatewayService as service, mockScenarioController } from "./gateway-service"

describe("mock gateway service", () => {
  beforeEach(() => mockScenarioController.setScenario("healthy"))

  it("uses only manually selected active accounts", async () => {
    expect((await service.getSnapshot()).activeAccountId).toBe("acc-01")
    expect((await service.clearActiveAccount()).activeAccountId).toBeNull()
    await expect(service.setActiveAccount("acc-02")).rejects.toThrow("不可用")
    expect((await service.setActiveAccount("acc-01")).activeAccountId).toBe("acc-01")
  })

  it("persists settings and codex state in memory", async () => {
    expect((await service.updateSettings({ requestMetadataLogging: false, theme: "dark" })).theme).toBe("dark")
    expect((await service.applyCodexConfig()).applied).toBe(true)
    expect((await service.restoreCodexConfig()).applied).toBe(false)
    expect((await service.restartCodex()).codexRunning).toBe(true)
  })

  it("completes the deterministic oauth flow", async () => {
    let login = await service.startLogin()
    for (let index = 0; index < 4; index += 1) login = await service.getLogin(login.loginId)
    expect(login.status).toBe("complete")
    expect(login.createdAccountId).toBeTruthy()
    expect((await service.getSnapshot()).accounts.some((account) => account.chatgptAccountId === login.createdAccountId)).toBe(true)
  })

  it("exposes empty and offline scenarios", async () => {
    mockScenarioController.setScenario("empty")
    expect((await service.getSnapshot()).accounts).toHaveLength(0)
    mockScenarioController.setScenario("offline")
    expect((await service.getSnapshot()).online).toBe(false)
    await expect(service.clearActiveAccount()).rejects.toThrow("离线")
  })
})
