import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { OAuthDialog } from "@/components/account/oauth-dialog"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"

describe("OAuthDialog", () => {
  it("keeps the initial footer at the dialog composition root", async () => {
    const service = createGatewayServiceFixture()
    render(<OAuthDialog service={service} onComplete={vi.fn()} />)

    await userEvent.click(screen.getByRole("button", { name: "添加账号" }))
    const dialog = screen.getByRole("dialog")
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')

    expect(dialog).toHaveClass("sm:max-w-md")
    expect(footer).not.toBeNull()
    expect(footer?.parentElement).toBe(dialog)
  })

  it("uses a semantic authorization link and a wrapping root footer", async () => {
    const service = createGatewayServiceFixture()
    render(<OAuthDialog service={service} onComplete={vi.fn()} />)

    await userEvent.click(screen.getByRole("button", { name: "添加账号" }))
    await userEvent.click(screen.getByRole("button", { name: "启动登录" }))

    const dialog = screen.getByRole("dialog")
    const link = await screen.findByRole("link", { name: "打开授权页面" })
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')
    expect(link).toHaveAttribute("href", "https://auth.openai.test/codex")
    expect(link.tagName).toBe("A")
    expect(footer).toHaveClass("sm:flex-wrap")
    expect(footer?.parentElement).toBe(dialog)
  })
})
