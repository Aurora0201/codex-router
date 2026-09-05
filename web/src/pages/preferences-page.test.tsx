import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { PreferencesPage } from "./preferences-page"
import { languageStorageKey } from "@/i18n"

describe("PreferencesPage", () => {
  it("uses single surfaces and keeps theme and logging controls connected", async () => {
    const service = createGatewayServiceFixture()
    const saveSettings = vi.spyOn(service, "saveSettings")
    const reload = vi.fn().mockResolvedValue(undefined)
    const onThemeChange = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <ThemeProvider>
        <Toaster>
          <PreferencesPage
            snapshot={service.snapshot}
            service={service}
            reload={reload}
            onThemeChange={onThemeChange}
          />
        </Toaster>
      </ThemeProvider>
    )
    expect(
      container.querySelectorAll('[data-slot="settings-surface"]')
    ).toHaveLength(3)
    expect(container.querySelector('[data-slot="card"]')).toBeNull()
    expect(
      container.querySelectorAll('[data-slot="animate-tabs"]')
    ).toHaveLength(2)
    expect(screen.getByRole("tablist", { name: "主题" })).toBeInTheDocument()
    expect(
      screen.getByRole("tablist", { name: "运行日志等级" })
    ).toBeInTheDocument()
    expect(
      container.querySelector(
        '[data-slot="settings-surface"] [data-slot="settings-surface"]'
      )
    ).toBeNull()
    await userEvent.click(screen.getByRole("tab", { name: "深色" }))
    expect(onThemeChange).toHaveBeenCalledWith("dark")
    await userEvent.click(screen.getByRole("tab", { name: "WARN" }))
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({ logLevel: "warn" })
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    await userEvent.click(
      screen.getByRole("switch", { name: "请求元数据记录" })
    )
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        requestMetadataLogging: false,
      })
    )
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
  })

  it("disables logging controls while saving and reports failure", async () => {
    const service = createGatewayServiceFixture()
    let rejectSave!: (error: Error) => void
    vi.spyOn(service, "saveSettings").mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject
        })
    )
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
    await userEvent.click(screen.getByRole("tab", { name: "ERROR" }))
    expect(
      screen.getByRole("switch", { name: "请求元数据记录" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("tab", { name: "WARN" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    await userEvent.click(screen.getByRole("tab", { name: "WARN" }))
    expect(service.saveSettings).toHaveBeenCalledTimes(1)
    rejectSave(new Error("Network unavailable"))
    expect(await screen.findByText("设置保存失败")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "WARN" })).not.toHaveAttribute(
        "aria-disabled",
        "true"
      )
    )
    expect(screen.getByRole("tab", { name: "INFO" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("disables directory copying in stdout mode", () => {
    const service = createGatewayServiceFixture()
    service.snapshot.health.logFilePath = null
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
    expect(
      screen.getByRole("button", { name: "Codex Router 运行日志" })
    ).toBeDisabled()
    expect(
      screen.getByText("标准输出模式，没有独立日志目录")
    ).toBeInTheDocument()
  })

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
    const environment = screen.getByRole("region", { name: "本地环境" })
    expect(
      environment.querySelector('[data-slot="settings-surface"]')
    ).toHaveClass("bg-muted")
    expect(environment.querySelector('[data-slot="card"]')).toBeNull()
    expect(environment.querySelectorAll("dl > div")).toHaveLength(3)
    expect(
      screen
        .getByRole("switch", { name: "请求元数据记录" })
        .closest('[data-slot="field"]')
    ).toHaveClass("items-center!")
    expect(screen.queryByText("Prompt logging")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "INFO" })).toHaveAttribute(
      "aria-selected",
      "true"
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
