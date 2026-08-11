import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"

function ShellProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <SidebarProvider>{children}</SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

describe("application shell", () => {
  it("collapses to the branded expand control without a resize rail", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ShellProviders>
        <AppSidebar page="accounts" onPageChange={vi.fn()} />
      </ShellProviders>
    )

    expect(container.querySelector('[data-slot="sidebar-rail"]')).toBeNull()
    expect(screen.getByText("Codex Router")).toHaveClass("font-brand")
    const brandMark = container.querySelector('[data-slot="brand-mark"]')
    expect(brandMark).toHaveClass("bg-sidebar-foreground")
    expect(brandMark).toHaveClass("size-6")
    expect(brandMark).not.toHaveClass("bg-primary")
    expect(brandMark).toHaveAttribute("style", expect.stringContaining("codex-router-icon.png"))

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    expect(
      await screen.findByRole("button", { name: "展开导航栏" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开导航栏" })).not.toHaveClass("bg-primary")
    expect(screen.queryByText("Identity router")).not.toBeInTheDocument()
  })

  it("renders a one-line header and plain Gateway status", () => {
    const { container } = render(
      <ShellProviders>
        <AppHeader page="accounts" online version="0.2.0" />
      </ShellProviders>
    )

    expect(screen.getByText("账号路由")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("在线 · v0.2.0")
    expect(screen.queryByText("身份、认证与流量控制")).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
  })
})
