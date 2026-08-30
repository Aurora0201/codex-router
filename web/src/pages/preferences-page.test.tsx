import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { PreferencesPage } from "./preferences-page"
import { languageStorageKey } from "@/i18n"

describe("PreferencesPage", () => {
  it("renders local environment actions and copies their directory paths", async () => {
    const service = createGatewayServiceFixture()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    render(
      <ThemeProvider>
        <Toaster>
          <PreferencesPage
            snapshot={service.snapshot}
            service={service}
            reload={vi.fn()}
            onThemeChange={vi.fn()}
          />
        </Toaster>
      </ThemeProvider>
    )
    expect(screen.getByText("Codex Router 版本")).toBeInTheDocument()
    expect(screen.getByText("Codex Router 运行日志")).toBeInTheDocument()
    const path = service.snapshot.health.dataDir
    expect(screen.getByText(path)).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Codex Router 版本" })
    ).toHaveAttribute("href", "https://github.com/Aurora0201/codex-router")
    expect(
      screen.getByRole("link", { name: "Codex Router 版本" })
    ).toHaveAttribute("target", "_blank")
    expect(
      screen.getByRole("link", { name: "Codex Router 版本" })
    ).toHaveAttribute("rel", "noopener noreferrer")
    await userEvent.click(screen.getByRole("button", { name: "数据目录" }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(service.snapshot.health.dataDir)
    )
    expect(screen.getByText("目录路径已复制")).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "Codex 配置备份" })
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("C:\\Users\\test\\.codex")
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Codex Router 运行日志" })
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "C:\\Users\\test\\.codex-router\\logs"
      )
    )
    const dataItem = screen
      .getByRole("button", { name: "数据目录" })
      .closest('[data-slot="item"]')
    expect(dataItem).toHaveClass(
      "enabled:cursor-pointer",
      "enabled:hover:bg-muted/50"
    )
    expect(dataItem?.querySelector('[data-slot="item-media"]')).toHaveClass(
      "size-10",
      "self-center!",
      "translate-y-0!"
    )
    expect(dataItem?.querySelector('[data-slot="item-actions"]')).toHaveClass(
      "self-center"
    )
    expect(
      screen
        .getByRole("switch", { name: "请求元数据记录" })
        .closest('[data-slot="field"]')
    ).toHaveClass("items-center!")
    expect(screen.queryByText("Prompt logging")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "INFO" })).toHaveAttribute(
      "data-active"
    )
  })

  it("switches the console language and persists the choice", async () => {
    const service = createGatewayServiceFixture()
    render(
      <ThemeProvider>
        <Toaster>
          <PreferencesPage
            snapshot={service.snapshot}
            service={service}
            reload={vi.fn()}
            onThemeChange={vi.fn()}
          />
        </Toaster>
      </ThemeProvider>
    )

    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "简体中文"
    )
    await userEvent.click(screen.getByRole("combobox", { name: "语言" }))
    await userEvent.click(screen.getByRole("option", { name: "English" }))

    expect(
      await screen.findByRole("heading", { name: "Preferences" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", { name: "Language" })
    ).toHaveTextContent("English")
    expect(document.documentElement).toHaveAttribute("lang", "en")
    expect(localStorage.getItem(languageStorageKey)).toBe("en")
    expect(screen.getByText("Local environment")).toBeInTheDocument()
  })
})
