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
      screen.getByRole("combobox", { name: "当前路由账号" })
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
