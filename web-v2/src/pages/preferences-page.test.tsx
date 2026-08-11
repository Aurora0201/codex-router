import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { PreferencesPage } from "./preferences-page"

describe("PreferencesPage", () => {
  it("renders local environment actions with Item and opens fixed targets", async () => {
    const service = createGatewayServiceFixture()
    const openLocalEnvironment = vi.spyOn(service, "openLocalEnvironment")
    render(
      <ThemeProvider><Toaster><PreferencesPage snapshot={service.snapshot} service={service} reload={vi.fn()} onThemeChange={vi.fn()} /></Toaster></ThemeProvider>
    )
    expect(screen.getByText("Codex Router 版本")).toBeInTheDocument()
    expect(screen.getByText("Codex Router 运行日志")).toBeInTheDocument()
    const path = service.snapshot.health.dataDir
    expect(screen.getByText(path)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Codex Router 版本" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "数据目录" }))
    await waitFor(() => expect(openLocalEnvironment).toHaveBeenCalledWith("data"))
    const dataItem = screen.getByRole("button", { name: "数据目录" }).closest('[data-slot="item"]')
    expect(dataItem).toHaveClass("enabled:cursor-pointer", "enabled:hover:bg-muted/50")
    expect(dataItem?.querySelector('[data-slot="item-media"]')).toHaveClass("size-10", "self-center!", "translate-y-0!")
    expect(screen.queryByText("Prompt logging")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "INFO" })).toHaveAttribute("data-active")
  })
})
