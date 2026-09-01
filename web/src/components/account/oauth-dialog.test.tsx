import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { OAuthDialog } from "@/components/account/oauth-dialog"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"

describe("OAuthDialog", () => {
  it("keeps the initial footer at the dialog composition root", async () => {
    const service = createGatewayServiceFixture()
    render(
      <OAuthDialog
        open
        onOpenChange={vi.fn()}
        service={service}
        onComplete={vi.fn()}
      />
    )
    const dialog = screen.getByRole("dialog")
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')

    expect(dialog).toHaveClass("sm:max-w-md")
    expect(footer).not.toBeNull()
    expect(footer?.parentElement).toBe(dialog)
  })

  it("uses a semantic authorization link and a wrapping root footer", async () => {
    const service = createGatewayServiceFixture()
    const replace = vi.fn()
    const authWindow = {
      location: { replace },
      close: vi.fn(),
      opener: window,
    } as unknown as Window
    const open = vi.spyOn(window, "open").mockReturnValue(authWindow)
    render(
      <OAuthDialog
        open
        onOpenChange={vi.fn()}
        service={service}
        onComplete={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "启动登录" }))

    const dialog = screen.getByRole("dialog")
    const link = await screen.findByRole("link", { name: "打开授权页面" })
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')
    expect(link).toHaveAttribute("href", "https://auth.openai.test/codex")
    expect(open).toHaveBeenCalledWith("about:blank", "_blank")
    expect(authWindow.opener).toBeNull()
    expect(replace).toHaveBeenCalledWith("https://auth.openai.test/codex")
    expect(link.tagName).toBe("A")
    expect(footer).toHaveClass("sm:flex-wrap")
    expect(footer?.parentElement).toBe(dialog)
    open.mockRestore()
  })

  it("creates one polling timer and clears it when the controlled dialog closes", async () => {
    const service = createGatewayServiceFixture()
    service.getLoginStatus = vi.fn(service.getLoginStatus)
    const setIntervalSpy = vi.spyOn(window, "setInterval")
    const clearIntervalSpy = vi.spyOn(window, "clearInterval")
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { rerender } = render(
      <OAuthDialog
        open
        onOpenChange={vi.fn()}
        service={service}
        onComplete={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: "启动登录" }))
    await waitFor(() =>
      expect(
        setIntervalSpy.mock.calls.filter((call) => call[1] === 900)
      ).toHaveLength(1)
    )
    const pollingTimer =
      setIntervalSpy.mock.results[
        setIntervalSpy.mock.calls.findIndex((call) => call[1] === 900)
      ]?.value
    rerender(
      <OAuthDialog
        open={false}
        onOpenChange={vi.fn()}
        service={service}
        onComplete={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(clearIntervalSpy).toHaveBeenCalledWith(pollingTimer)
    )

    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    open.mockRestore()
  })
})
