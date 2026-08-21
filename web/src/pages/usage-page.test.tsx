import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { UsagePage } from "@/pages/usage-page"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"

describe("UsagePage", () => {
  it("loads the default 14-day local aggregate without an account filter", async () => {
    const service = createGatewayServiceFixture()
    const getCodexUsage = vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      status: "ready", scope: "local_codex_home", generatedAt: Date.now(), timezone: "Asia/Shanghai",
      coverage: { firstEventAt: Date.now(), lastEventAt: Date.now(), rollouts: 1, sourceRollouts: 1, retainedRollouts: 0, lastScannedAt: Date.now(), lastRetentionAt: null, parseWarnings: 0, scan: { complete: true, lastSuccessfulAt: Date.now(), pendingMissingRollouts: 0 }, retention: { pendingAuditEvents: 0, lastVerifiedAt: Date.now() }, backup: { status: "ready", lastSuccessfulAt: Date.now(), generations: 1, lastRecoveryAt: null } },
      summary: { totalTokens: 180, todayTokens: 180, dailyAverage: 180, inputTokens: 160, cachedInputTokens: 50, uncachedInputTokens: 110, outputTokens: 20, reasoningOutputTokens: 6, cacheHitPercent: 31.25, sessions: 1, tasksStarted: 1, tasksCompleted: 1, abortedTurns: 0, compactions: 0, completionPercent: 100, tokensPerCompletedTask: 180 },
      daily: [{ date: "2026-08-21", inputTokens: 160, cachedInputTokens: 50, uncachedInputTokens: 110, outputTokens: 20, reasoningOutputTokens: 6, totalTokens: 180, sessions: 1, tasks: 1, rollingAverage7d: 180, isPartial: true }],
      dailyModels: [{ date: "2026-08-21", totalTokens: 180, isPartial: true, models: [{ key: "gpt-test", label: "gpt-test", totalTokens: 120 }, { key: "gpt-other", label: "gpt-other", totalTokens: 60 }] }],
      models: [{ key: "gpt-test", label: "gpt-test", totalTokens: 120, tasks: 1, share: 2 / 3 }, { key: "gpt-other", label: "gpt-other", totalTokens: 60, tasks: 1, share: 1 / 3 }],
      projects: [{ key: "hash", label: "codespace/codex-router", totalTokens: 180, tasks: 1, share: 1 }],
      heatmap: [{ weekday: "Fri", hour: 10, totalTokens: 180 }], filters: { models: ["gpt-test"], projects: [{ key: "hash", label: "codespace/codex-router" }] },
    })
    render(<TooltipProvider><UsagePage service={service} /></TooltipProvider>)
    expect(await screen.findByText("每日 Token 趋势")).toBeInTheDocument()
    const modelTrend = screen.getByLabelText("每日模型分布趋势")
    expect(within(modelTrend).getByText("gpt-test")).toHaveClass("font-mono")
    expect(within(modelTrend).getByText("gpt-other")).toHaveClass("font-mono")
    expect(screen.getByText("本机 Codex 用量汇总")).toBeInTheDocument()
    expect(screen.getByText(/本机数据始于/)).toBeInTheDocument()
    expect(screen.getByText("扫描完整性")).toBeInTheDocument()
    expect(screen.getByText("待同步审计")).toBeInTheDocument()
    expect(screen.getByText("快照代数")).toBeInTheDocument()
    expect(screen.queryByLabelText("账号筛选")).not.toBeInTheDocument()
    await waitFor(() => expect(getCodexUsage).toHaveBeenCalledWith({ range: "14d", model: undefined, project: undefined }))
  })

  it("shows long project names in a non-overlapping accessible ranking list", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    const base = await service.getCodexUsage({ range: "14d" })
    const longName = "codespace/a-very-long-project-name-that-must-not-overlap-the-token-value"
    vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      ...base,
      coverage: { ...base.coverage, rollouts: 2, sourceRollouts: 1, retainedRollouts: 1, lastRetentionAt: Date.now() },
      projects: [
        { key: "long", label: longName, totalTokens: 900, tasks: 2, share: .9 },
        { key: "uncategorized-conversation", label: "无分类对话", totalTokens: 100, tasks: 1, share: .1 },
      ],
      filters: { ...base.filters, projects: [{ key: "long", label: longName }, { key: "uncategorized-conversation", label: "无分类对话" }] },
    })
    render(<TooltipProvider><UsagePage service={service} /></TooltipProvider>)
    const ranking = await screen.findByLabelText("项目分布排名")
    const label = within(ranking).getByText(longName)
    expect(label).toHaveClass("truncate")
    expect(label).toHaveAttribute("tabindex", "0")
    expect(within(ranking).getByRole("progressbar", { name: `${longName} Token 占比 90.0%` })).toBeInTheDocument()
    expect(within(ranking).getByText("无分类对话")).toBeInTheDocument()
    expect(screen.getByText("永久保留").parentElement).toHaveTextContent("1")
    expect(screen.getByText(/白名单派生历史永久保留/)).toBeInTheDocument()

    const projectFilter = screen.getByRole("combobox", { name: "项目筛选" })
    expect(projectFilter).toHaveClass("w-full", "min-w-0", "overflow-hidden")
    expect(projectFilter.parentElement).toHaveAttribute("data-slot", "tooltip-trigger")
    expect(projectFilter.parentElement).toHaveClass("block", "w-full", "min-w-0", "sm:w-64", "lg:w-72")
    await user.click(projectFilter)
    const longProjectOption = await screen.findByRole("option", { name: longName })
    expect(longProjectOption).toHaveClass("min-w-0", "max-w-full", "overflow-hidden", "font-mono")
    expect(within(longProjectOption).getByText(longName)).toHaveClass("truncate")
    expect(longProjectOption).toHaveAttribute("title", longName)
    await user.click(longProjectOption)
    expect(within(projectFilter).getByText(longName)).toHaveClass("truncate")
  })

  it("uses theme fonts, desktop-only equal-height rows, and scrollable distributions", async () => {
    const service = createGatewayServiceFixture()
    const base = await service.getCodexUsage({ range: "14d" })
    const models = Array.from({ length: 11 }, (_, index) => ({
      key: `gpt-test-${index}`,
      label: `gpt-test-${index}`,
      totalTokens: 110 - index,
      tasks: 1,
      share: (110 - index) / 1155,
    }))
    vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      ...base,
      coverage: { ...base.coverage, rollouts: 3 },
      models,
      projects: [
        { key: "project-hash", label: "codespace/codex-router", totalTokens: 800, tasks: 2, share: .8 },
        { key: "uncategorized-conversation", label: "无分类对话", totalTokens: 150, tasks: 1, share: .15 },
        { key: "other", label: "其他", totalTokens: 50, tasks: 1, share: .05 },
      ],
      filters: {
        models: models.map((item) => item.key),
        projects: [
          { key: "project-hash", label: "codespace/codex-router" },
          { key: "uncategorized-conversation", label: "无分类对话" },
        ],
      },
    })

    render(<TooltipProvider><UsagePage service={service} /></TooltipProvider>)

    const modelScrollArea = await screen.findByLabelText("模型分布滚动区域")
    expect(within(modelScrollArea).getByText("gpt-test-10")).toBeInTheDocument()
    expect(within(modelScrollArea).getByLabelText("模型分布")).toHaveClass("font-mono")
    expect(screen.getByLabelText("项目分布滚动区域")).toBeInTheDocument()
    expect(screen.getByLabelText("活跃热力图滚动区域")).toBeInTheDocument()

    const projectRanking = screen.getByLabelText("项目分布排名")
    expect(within(projectRanking).getByText("codespace/codex-router")).toHaveClass("font-mono")
    expect(within(projectRanking).getByText("无分类对话")).not.toHaveClass("font-mono")
    expect(within(projectRanking).getByText("其他")).not.toHaveClass("font-mono")

    const trendRow = screen.getByText("每日 Token 趋势").closest("[data-slot=card]")?.parentElement
    const distributionRow = screen.getByText("模型分布").closest("[data-slot=card]")?.parentElement
    const workloadRow = screen.getByText("工作负载").closest("[data-slot=card]")?.parentElement
    expect(trendRow).toHaveClass("lg:h-[28rem]")
    expect(distributionRow).toHaveClass("lg:h-[29rem]")
    expect(workloadRow).toHaveClass("lg:h-[23rem]")
    expect(trendRow).not.toHaveClass("h-[28rem]")
    expect(distributionRow).not.toHaveClass("h-[29rem]")
    expect(workloadRow).not.toHaveClass("h-[23rem]")
  })
})
