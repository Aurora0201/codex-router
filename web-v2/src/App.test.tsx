import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import App from "./App"
import { mockScenarioController } from "@/services/mock/gateway-service"

describe("App", () => {
  beforeEach(() => { window.history.replaceState({}, "", "/admin-v2/"); mockScenarioController.setScenario("healthy") })

  it("renders the account control plane and settings tab", async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText("所有流量使用手动选择的账号")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "选择当前账号" })).toHaveTextContent("acct_01J…F6K9 · Plus")
    expect(screen.getAllByRole("button", { name: "添加账号" })[0]).toBeEnabled()
    await user.click(screen.getByRole("tab", { name: "设置" }))
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument()
    expect(screen.getByText("Prompt 日志")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "主题" })).toHaveTextContent("跟随系统")
  })

  it("renders an actionable empty state from the url scenario", async () => {
    window.history.replaceState({}, "", "/admin-v2/?scenario=empty")
    render(<App />)
    expect(await screen.findByText("尚未添加账号")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "添加账号" })[0]).toBeEnabled()
  })
})
