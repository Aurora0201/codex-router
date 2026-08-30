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
      status: "ready",
      scope: "local_codex_home",
      generatedAt: Date.now(),
      timezone: "Asia/Shanghai",
      coverage: {
        firstEventAt: Date.now(),
        lastEventAt: Date.now(),
        rollouts: 1,
        sourceRollouts: 1,
        retainedRollouts: 0,
        lastScannedAt: Date.now(),
        lastRetentionAt: null,
        parseWarnings: 0,
        scan: {
          complete: true,
          lastSuccessfulAt: Date.now(),
          pendingMissingRollouts: 0,
        },
        retention: { pendingAuditEvents: 0, lastVerifiedAt: Date.now() },
        backup: {
          status: "ready",
          lastSuccessfulAt: Date.now(),
          generations: 1,
          lastRecoveryAt: null,
        },
      },
      summary: {
        totalTokens: 180,
        todayTokens: 180,
        dailyAverage: 180,
        inputTokens: 160,
        cachedInputTokens: 50,
        uncachedInputTokens: 110,
        outputTokens: 20,
        reasoningOutputTokens: 6,
        cacheHitPercent: 31.25,
        sessions: 1,
        tasksStarted: 1,
        tasksCompleted: 1,
        abortedTurns: 0,
        compactions: 0,
        completionPercent: 100,
        tokensPerCompletedTask: 180,
      },
      daily: [
        {
          date: "2026-08-21",
          inputTokens: 160,
          cachedInputTokens: 50,
          uncachedInputTokens: 110,
          outputTokens: 20,
          reasoningOutputTokens: 6,
          totalTokens: 180,
          sessions: 1,
          tasks: 1,
          rollingAverage7d: 180,
          isPartial: true,
        },
      ],
      dailyModels: [],
      models: [
        {
          key: "gpt-test",
          label: "gpt-test",
          totalTokens: 120,
          tasks: 1,
          share: 2 / 3,
        },
      ],
      projects: [
        {
          key: "hash",
          label: "codespace/codex-router",
          totalTokens: 180,
          tasks: 1,
          share: 1,
        },
      ],
      heatmap: [
        { date: "2026-08-21", hour: 10, totalTokens: 180 },
        { date: "2026-08-22", hour: 0, totalTokens: 0 },
      ],
      filters: {
        models: ["gpt-test"],
        projects: [{ key: "hash", label: "codespace/codex-router" }],
      },
    })
    render(
      <TooltipProvider>
        <UsagePage service={service} />
      </TooltipProvider>
    )

    expect(await screen.findByLabelText("每日 Token 趋势")).toBeInTheDocument()
    expect(screen.getByText("区间总 Token")).toBeInTheDocument()
    expect(screen.getByText(/本机数据始于/)).toBeInTheDocument()
    // Every coverage diagnostic is on screen at once: the wide strip fits all
    // sixteen without a scroll of its own.
    for (const label of ["扫描完整性", "待同步审计", "快照代数", "解析警告"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // The heatmap describes the whole history, so it says so rather than
    // implying it follows the filters.
    expect(screen.getByText("全部历史 · 不随筛选变化")).toBeInTheDocument()
    expect(
      screen.getByLabelText("2026年08月21日 10:00 · 180 Token")
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText("2026年08月22日 00:00 · 0 Token")
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText("模型分布排名")).getByText("gpt-test")
    ).not.toHaveClass("font-mono")
    const modelFilter = screen.getByRole("combobox", { name: "模型筛选" })
    await userEvent.click(modelFilter)
    expect(await screen.findByRole("option", { name: "gpt-test" })).not.toHaveClass(
      "font-mono"
    )
    expect(screen.queryByLabelText("账号筛选")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(getCodexUsage).toHaveBeenCalledWith({
        range: "14d",
        model: undefined,
        project: undefined,
      })
    )
  })

  it("shows long project names in a non-overlapping accessible ranking list", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    const base = await service.getCodexUsage({ range: "14d" })
    const longName =
      "codespace/a-very-long-project-name-that-must-not-overlap-the-token-value"
    vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      ...base,
      coverage: {
        ...base.coverage,
        rollouts: 2,
        sourceRollouts: 1,
        retainedRollouts: 1,
        lastRetentionAt: Date.now(),
      },
      projects: [
        {
          key: "long",
          label: longName,
          totalTokens: 900,
          tasks: 2,
          share: 0.9,
        },
        {
          key: "uncategorized-conversation",
          label: "无分类对话",
          totalTokens: 100,
          tasks: 1,
          share: 0.1,
        },
      ],
      filters: {
        ...base.filters,
        projects: [
          { key: "long", label: longName },
          { key: "uncategorized-conversation", label: "无分类对话" },
        ],
      },
    })
    render(
      <TooltipProvider>
        <UsagePage service={service} />
      </TooltipProvider>
    )

    const ranking = await screen.findByLabelText("项目分布排名")
    const label = within(ranking).getByText(longName)
    expect(label).toHaveClass("truncate")
    // Reachable by keyboard, not only by hover.
    expect(label).toHaveAttribute("tabindex", "0")
    expect(
      within(ranking).getByRole("img", {
        name: `${longName} Token 占比 90.0%`,
      })
    ).toBeInTheDocument()
    // Project names are readable labels, so both real projects and synthetic
    // buckets inherit the body face instead of the technical-data face.
    expect(label).not.toHaveClass("font-mono")
    expect(within(ranking).getByText("无分类对话")).not.toHaveClass("font-mono")

    const projectFilter = screen.getByRole("combobox", { name: "项目筛选" })
    const modelFilter = screen.getByRole("combobox", { name: "模型筛选" })
    for (const filter of [modelFilter, projectFilter]) {
      expect(filter).toHaveClass("rounded-md")
      expect(filter).not.toHaveClass("rounded-xl")
    }
    expect(projectFilter).toHaveClass("w-full", "min-w-0", "overflow-hidden")
    expect(projectFilter.parentElement).toHaveAttribute(
      "data-slot",
      "tooltip-trigger"
    )
    await user.click(projectFilter)
    const longProjectOption = await screen.findByRole("option", {
      name: longName,
    })
    expect(longProjectOption).toHaveClass(
      "min-w-0",
      "max-w-full",
      "overflow-hidden"
    )
    expect(longProjectOption).not.toHaveClass("font-mono")
    expect(within(longProjectOption).getByText(longName)).toHaveClass(
      "truncate"
    )
    await user.click(longProjectOption)
    expect(within(projectFilter).getByText(longName)).toHaveClass("truncate")
  })

  it("keeps both ranking cards a fixed height so a long list scrolls instead of stretching", async () => {
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
        {
          key: "project-hash",
          label: "codespace/codex-router",
          totalTokens: 800,
          tasks: 2,
          share: 0.8,
        },
        {
          key: "other",
          label: "其他",
          totalTokens: 50,
          tasks: 1,
          share: 0.05,
        },
      ],
      filters: {
        models: models.map((item) => item.key),
        projects: [{ key: "project-hash", label: "codespace/codex-router" }],
      },
    })

    render(
      <TooltipProvider>
        <UsagePage service={service} />
      </TooltipProvider>
    )

    const modelScrollArea = await screen.findByLabelText("模型分布滚动区域")
    // The eleventh row is rendered rather than dropped: the card scrolls.
    expect(within(modelScrollArea).getByText("gpt-test-10")).toBeInTheDocument()
    expect(screen.getByLabelText("项目分布滚动区域")).toBeInTheDocument()
    const heatmapScrollArea = screen.getByLabelText("活跃热力图滚动区域")
    expect(heatmapScrollArea).toHaveClass(
      "[&_[data-slot=scroll-area-scrollbar]]:hidden"
    )
    expect(heatmapScrollArea).not.toHaveClass(
      "[&_[data-slot=scroll-area-scrollbar]]:h-1.5"
    )
    for (const selector of [".bg-linear-to-b", ".bg-linear-to-t"]) {
      expect(
        heatmapScrollArea.parentElement?.querySelector(selector)
      ).toHaveClass("transition-opacity", "duration-200")
    }

    // Both cards pin the same body height, so an uneven list cannot skew them.
    for (const label of ["模型分布滚动区域", "项目分布滚动区域"]) {
      const region = screen.getByLabelText(label)
      expect(region.closest(".h-60")).not.toBeNull()
      // A fade says "there is more" instead of a second scrollbar.
      expect(
        region.parentElement?.querySelector(".bg-linear-to-t")
      ).not.toBeNull()
      expect(region).toHaveClass(
        "[&_[data-slot=scroll-area-scrollbar]]:hidden"
      )
    }

    const projectRanking = screen.getByLabelText("项目分布排名")
    expect(
      within(projectRanking).getByText("codespace/codex-router")
    ).not.toHaveClass("font-mono")
    expect(within(projectRanking).getByText("其他")).not.toHaveClass(
      "font-mono"
    )
  })

  it("gives every panel title an icon and one band to sit centred in", async () => {
    const service = createGatewayServiceFixture()
    const base = await service.getCodexUsage({ range: "14d" })
    vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      ...base,
      coverage: { ...base.coverage, rollouts: 3 },
    })
    render(
      <TooltipProvider>
        <UsagePage service={service} />
      </TooltipProvider>
    )

    await screen.findByText("区间总 Token")
    const headings = screen.getAllByRole("heading", { level: 2 })
    expect(headings).toHaveLength(6)
    for (const heading of headings) {
      expect(heading.querySelector("svg")).not.toBeNull()
      // A fixed band, not padding: the hint is smaller than the title, so only
      // a shared box centres both instead of sitting them on one baseline.
      expect(heading.parentElement).toHaveClass("h-11", "items-center")
      expect(heading.parentElement?.parentElement).toHaveClass("pb-2")
      expect(heading.parentElement?.parentElement).not.toHaveClass("pt-2")
    }
  })

  it("spends its one dark panel on the headline and keeps every series on one hue", async () => {
    const service = createGatewayServiceFixture()
    const base = await service.getCodexUsage({ range: "14d" })
    vi.spyOn(service, "getCodexUsage").mockResolvedValue({
      ...base,
      coverage: { ...base.coverage, rollouts: 3 },
    })
    render(
      <TooltipProvider>
        <UsagePage service={service} />
      </TooltipProvider>
    )

    await screen.findByText("区间总 Token")
    // Exactly one emphasis block: the hero. Anything more and it stops being one.
    expect(document.querySelectorAll(".bg-emphasis")).toHaveLength(1)
    expect(screen.getByText("区间总 Token").closest(".bg-emphasis")).not.toBeNull()
  })
})
