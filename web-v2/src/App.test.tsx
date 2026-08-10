import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import App from "./App"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"

function renderApp() {
  return render(
    <ThemeProvider>
      <Toaster>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </Toaster>
    </ThemeProvider>
  )
}

describe("App", () => {
  it("loads the account console and switches pages through the shadcn Sidebar", async () => {
    const user = userEvent.setup()
    renderApp()
    expect(
      await screen.findByRole("heading", { name: "账号与路由" })
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("radio", { name: /设为当前路由/ })
    ).not.toHaveLength(0)
    expect(screen.queryByText("Manual routing")).not.toBeInTheDocument()
    expect(screen.queryByText("实时路由")).not.toBeInTheDocument()
    expect(screen.queryByText("运行概览")).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "搜索授权账号" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Gateway 设置" }))
    expect(
      await screen.findByRole("heading", { name: "Gateway 设置" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("switch", { name: "Request metadata logging" })
    ).toBeChecked()
  })
})
