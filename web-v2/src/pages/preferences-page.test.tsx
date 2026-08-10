import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { PreferencesPage } from "./preferences-page"

describe("PreferencesPage", () => {
  it("balances environment items and reveals full paths with HoverCard", async () => {
    const service = createGatewayServiceFixture()
    render(
      <ThemeProvider><Toaster><PreferencesPage snapshot={service.snapshot} service={service} reload={vi.fn()} onThemeChange={vi.fn()} /></Toaster></ThemeProvider>
    )
    expect(screen.getByText("Codex Router 版本")).toBeInTheDocument()
    expect(screen.getByText("Codex Router 运行日志")).toBeInTheDocument()
    const path = service.snapshot.health.dataDir
    const trigger = screen.getByRole("button", { name: path })
    await userEvent.hover(trigger)
    await waitFor(() => expect(screen.getAllByText(path).length).toBeGreaterThan(1))
    expect(screen.queryByText("Prompt logging")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "INFO" })).toHaveAttribute("data-active")
  })
})
