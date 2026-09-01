import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  BadgeCheckIcon,
  CircleOffIcon,
  CpuIcon,
  DatabaseIcon,
  FoldVerticalIcon,
  FolderIcon,
  GaugeIcon,
  InfoIcon,
  LayersIcon,
  MessageSquareIcon,
  PercentIcon,
  PlayIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Bar, ComposedChart, Line } from "recharts"

import {
  Tabs,
  TabsList,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { Fact, Figure, Tally } from "@/components/app/figure"
import { Panel } from "@/components/app/panel"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSlowLoad } from "@/hooks/use-slow-load"
import { MachineValue } from "@/components/app/machine-value"
import { cn } from "@/lib/utils"
import type {
  CodexUsageDashboard,
  CodexUsageRange,
  GatewayService,
} from "@/services/contracts"

/**
 * Cached input sits under uncached input, which sits under output: they are
 * nested parts of one total, so the stack order is the ramp order.
 */
const trendConfig = {
  cachedInputTokens: { label: "缓存输入", color: "var(--chart-1)" },
  uncachedInputTokens: { label: "非缓存输入", color: "var(--chart-3)" },
  outputTokens: { label: "输出", color: "var(--chart-5)" },
  rollingAverage7d: { label: "7 日均线", color: "var(--emphasis-muted)" },
} satisfies ChartConfig

const ranges: Array<{ value: CodexUsageRange; label: string }> = [
  { value: "1d", label: "当天" },
  { value: "7d", label: "最近 7 天" },
  { value: "14d", label: "最近 14 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "90d", label: "最近 90 天" },
  { value: "all", label: "全部历史" },
]
function weekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (day + 6) % 7
}

function dateParts(date: string) {
  const [year, month, day] = date.split("-")
  return { year, month, day }
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value)
}
function fullTokens(value: number): string {
  return new Intl.NumberFormat().format(value)
}
function formatDate(value: number | null): string {
  return value ? new Date(value).toLocaleString() : "—"
}
function formatDay(value: number): string {
  return new Date(value).toLocaleDateString()
}
function share(part: number, whole: number): number {
  return whole ? (part / whole) * 100 : 0
}

function Ranking({
  rows,
  scrollLabel,
  listLabel,
  emptyTitle,
  emptyDescription,
}: {
  rows: Array<{
    key: string
    label: string
    totalTokens: number
    share: number
  }>
  scrollLabel: string
  listLabel: string
  emptyTitle: string
  emptyDescription: string
}) {
  const { t } = useTranslation()
  if (!rows.length)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea
        // The fade below carries "there is more"; a bar as well would be two
        // ways of saying it.
        className="h-full [&_[data-slot=scroll-area-scrollbar]]:hidden"
        aria-label={scrollLabel}
      >
        <ul className="grid gap-3 pb-5" aria-label={listLabel}>
          {rows.map((row) => (
            <li className="grid gap-1.5" key={row.key}>
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        className="min-w-0 truncate rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    }
                  >
                    {row.label}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm break-all">
                    {row.label}
                  </TooltipContent>
                </Tooltip>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatTokens(row.totalTokens)}
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-foreground/10"
                role="img"
                aria-label={t("{{project}} Token 占比 {{percent}}", {
                  project: row.label,
                  percent: `${(row.share * 100).toFixed(1)}%`,
                })}
              >
                <div
                  // The share slides to its new length rather than jumping to
                  // it: on a fast range switch this is the only thing that
                  // says the numbers moved, and a width is one of the few
                  // things that can say it without anything blinking.
                  className="h-full rounded-full bg-chart-4 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${Math.max(row.share * 100, 1)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-muted to-transparent"
      />
    </div>
  )
}

function LoadingDashboard() {
  return (
    <div
      className="grid grid-cols-12 gap-4"
      aria-label="正在扫描本机 Codex 用量"
    >
      <Skeleton className="col-span-12 h-72 rounded-2xl xl:col-span-8" />
      <Skeleton className="col-span-12 h-72 rounded-2xl xl:col-span-4" />
      <Skeleton className="col-span-12 h-64 rounded-2xl md:col-span-6" />
      <Skeleton className="col-span-12 h-64 rounded-2xl md:col-span-6" />
    </div>
  )
}

export function UsagePage({
  service,
  revision = 0,
}: {
  service: GatewayService
  revision?: number
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<CodexUsageRange>("14d")
  const [model, setModel] = useState("all")
  const [project, setProject] = useState("all")
  const [data, setData] = useState<CodexUsageDashboard | null>(null)
  const [loadedFilters, setLoadedFilters] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState(0)
  const heatmapScrollRef = useRef<HTMLDivElement>(null)
  const [heatmapFade, setHeatmapFade] = useState({ top: false, bottom: false })

  const filterKey = `${range}|${model}|${project}`

  useEffect(() => {
    let cancelled = false
    void service
      .getCodexUsage({
        range,
        model: model === "all" ? undefined : model,
        project: project === "all" ? undefined : project,
      })
      .then((next) => {
        if (!cancelled) {
          setData(next)
          setError(null)
        }
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
      .finally(() => {
        if (!cancelled) setLoadedFilters(filterKey)
      })
    return () => {
      cancelled = true
    }
  }, [service, range, model, project, revision, request, filterKey])

  // Derived, so the dim answers the question "is what is on screen the answer
  // to what was asked" — and leaves the background refreshes alone, since they
  // arrive under the same filters. Held back until the load is slow enough to
  // need explaining; a switch that lands in 200ms just updates the numbers.
  const busy = useSlowLoad(
    loadedFilters !== null && loadedFilters !== filterKey
  )

  // During local HMR the page can briefly talk to an older running gateway.
  // Ignore its former weekday/hour cells instead of taking down the page.
  const heatmap = useMemo(
    () =>
      (data?.heatmap ?? []).filter(
        (cell) =>
          typeof (cell as { date?: unknown }).date === "string" &&
          typeof (cell as { hour?: unknown }).hour === "number"
      ),
    [data]
  )
  const heatRows = useMemo(() => {
    const rows = new Map<
      string,
      { date: string; hours: number[]; totalTokens: number }
    >()
    for (const cell of heatmap) {
      const row = rows.get(cell.date) ?? {
        date: cell.date,
        hours: Array.from({ length: 24 }, () => 0),
        totalTokens: 0,
      }
      row.hours[cell.hour] = cell.totalTokens
      row.totalTokens += cell.totalTokens
      rows.set(cell.date, row)
    }
    return [...rows.values()]
  }, [heatmap])

  useLayoutEffect(() => {
    const viewport = heatmapScrollRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    if (!viewport) return

    const updateFade = () => {
      const maxScrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight
      )
      setHeatmapFade({
        top: viewport.scrollTop > 1,
        bottom: viewport.scrollTop < maxScrollTop - 1,
      })
    }

    viewport.scrollTop = viewport.scrollHeight
    updateFade()
    viewport.addEventListener("scroll", updateFade)

    return () => viewport.removeEventListener("scroll", updateFade)
  }, [heatRows.length])
  const heatMax = Math.max(0, ...heatmap.map((cell) => cell.totalTokens))
  const rhythm = useMemo(() => {
    const total = heatRows.reduce((sum, row) => sum + row.totalTokens, 0)
    const peak = heatRows.reduce<(typeof heatRows)[number] | null>(
      (best, row) => (best && best.totalTokens >= row.totalTokens ? best : row),
      null
    )
    const within = (predicate: (row: (typeof heatRows)[number]) => boolean) =>
      total
        ? (heatRows
            .filter(predicate)
            .reduce((sum, row) => sum + row.totalTokens, 0) /
            total) *
          100
        : 0
    return {
      busiestDate: peak?.date ?? null,
      activeDays: heatRows.filter((row) => row.totalTokens > 0).length,
      weekendPercent: within((row) => weekdayIndex(row.date) >= 5),
    }
  }, [heatRows])

  const formatHeatmapDate = (date: string) =>
    t("{{year}}年{{month}}月{{day}}日", dateParts(date))
  const selectedProject =
    project === "all"
      ? null
      : data?.filters.projects.find((item) => item.key === project)
  const selectedProjectLabel = selectedProject?.label ?? t("全部项目")

  const summary = data?.summary
  const composition = summary
    ? [
        {
          label: t("缓存输入"),
          value: summary.cachedInputTokens,
          className: "bg-chart-1",
        },
        {
          label: t("非缓存输入"),
          value: summary.uncachedInputTokens,
          className: "bg-chart-3",
        },
        {
          label: t("输出"),
          value: summary.outputTokens - summary.reasoningOutputTokens,
          className: "bg-chart-5",
        },
        {
          label: t("推理输出"),
          value: summary.reasoningOutputTokens,
          className: "bg-chart-4",
        },
      ]
    : []

  const filters = (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label={t("用量筛选") as string}
    >
      {/* The same animated Tabs the logs and preferences pages use, rather than
          a second hand-rolled switcher that drifts from them. */}
      <Tabs
        value={range}
        onValueChange={(value) => setRange(value as CodexUsageRange)}
      >
        <TabsList aria-label={t("时间范围") as string}>
          {ranges.map((item) => (
            <TabsTab key={item.value} value={item.value}>
              {t(item.label)}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      <Select value={model} onValueChange={(value) => value && setModel(value)}>
        <SelectTrigger
          className="h-9 w-44 rounded-md"
          aria-label={t("模型筛选")}
        >
          <SelectValue>{model === "all" ? t("全部模型") : model}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">{t("全部模型")}</SelectItem>
            {data?.filters.models.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={project}
        onValueChange={(value) => value && setProject(value)}
      >
        <Tooltip>
          <TooltipTrigger
            render={<span className="block w-full min-w-0 sm:w-64" />}
          >
            <SelectTrigger
              className="h-9 w-full min-w-0 overflow-hidden rounded-md"
              aria-label={t("项目筛选")}
            >
              <SelectValue className="min-w-0 overflow-hidden">
                <span className="min-w-0 flex-1 truncate">
                  {selectedProjectLabel}
                </span>
              </SelectValue>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm break-all">
            {selectedProjectLabel}
          </TooltipContent>
        </Tooltip>
        <SelectContent
          alignItemWithTrigger={false}
          className="w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]"
        >
          <SelectGroup>
            <SelectItem value="all">{t("全部项目")}</SelectItem>
            {data?.filters.projects.map((item) => (
              <SelectItem
                aria-label={item.label}
                title={item.label}
                className="max-w-full min-w-0 overflow-hidden [&>span:first-child]:min-w-0 [&>span:first-child]:shrink [&>span:first-child]:overflow-hidden"
                key={item.key}
                value={item.key}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {item.label}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("用量分析")}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {t(
              "数据来自主 CODEX_HOME 中所有账号共同产生的会话记录，不能按账号拆分，也不代表账单或账号额度。"
            )}
            {data?.status === "scanning" ? (
              <Badge variant="secondary">{t("正在更新")}</Badge>
            ) : null}
            {data?.status === "partial" ? (
              <Badge variant="outline">{t("部分数据")}</Badge>
            ) : null}
          </p>
        </div>
        {filters}
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{t("用量数据载入失败")}</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRequest((value) => value + 1)}
            >
              {t("重试")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!data && !error ? <LoadingDashboard /> : null}

      {data && data.coverage.rollouts === 0 && data.status !== "scanning" ? (
        <Empty className="min-h-80 rounded-2xl bg-card ring-1 ring-foreground/10">
          <EmptyMedia variant="icon">
            <DatabaseIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{t("没有本地用量数据")}</EmptyTitle>
            <EmptyDescription>
              {t("Codex 创建会话记录后，用量趋势会自动出现在这里。")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {data && data.coverage.rollouts > 0 && summary ? (
        // The previous window stays up while the next one loads; the dim says
        // "updating" without moving anything on the page.
        <div
          className={cn(
            "grid grid-cols-12 gap-4 transition-opacity duration-200 motion-reduce:transition-none",
            busy && "opacity-60"
          )}
          aria-busy={busy}
        >
          {/* The one dark block on the page: the headline number and its shape.
              Everything else stays on light surfaces so this reads as the hero. */}
          <section className="col-span-12 rounded-2xl bg-emphasis p-2 text-emphasis-foreground xl:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-4 px-3 py-2.5">
              <div>
                <p className="text-xs text-emphasis-muted">
                  {t("区间总 Token")}
                </p>
                <p
                  className="mt-1 text-3xl leading-none font-semibold tabular-nums"
                  title={fullTokens(summary.totalTokens)}
                >
                  {formatTokens(summary.totalTokens)}
                </p>
              </div>
              <ul className="flex gap-6 text-right">
                {[
                  {
                    label: t("今日"),
                    value: formatTokens(summary.todayTokens),
                  },
                  {
                    label: t("日均"),
                    value: formatTokens(summary.dailyAverage),
                  },
                  {
                    label: t("缓存命中"),
                    value: `${summary.cacheHitPercent.toFixed(1)}%`,
                  },
                ].map((item) => (
                  <li key={item.label}>
                    <p className="text-xs text-emphasis-muted">{item.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {item.value}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-emphasis-surface p-3">
              <ChartContainer
                config={trendConfig}
                className="h-44 w-full"
                aria-label={t("每日 Token 趋势") as string}
              >
                <ComposedChart
                  accessibilityLayer
                  data={data.daily}
                  margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
                >
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        // Inside the emphasis panel this would inherit
                        // --emphasis-foreground onto its own light background.
                        className="text-foreground"
                        formatter={(value, name) => (
                          <div className="flex min-w-36 justify-between gap-3">
                            <span className="text-muted-foreground">
                              {
                                trendConfig[name as keyof typeof trendConfig]
                                  ?.label
                              }
                            </span>
                            <MachineValue value={fullTokens(Number(value))} />
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar
                    dataKey="cachedInputTokens"
                    stackId="tokens"
                    fill="var(--color-cachedInputTokens)"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="uncachedInputTokens"
                    stackId="tokens"
                    fill="var(--color-uncachedInputTokens)"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="outputTokens"
                    stackId="tokens"
                    fill="var(--color-outputTokens)"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="rollingAverage7d"
                    type="monotone"
                    stroke="var(--color-rollingAverage7d)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emphasis-muted">
                <MachineValue value={data.daily[0]?.date.slice(5) ?? ""} />
                <ul className="flex flex-wrap items-center gap-3">
                  {[
                    { name: t("缓存输入"), className: "bg-chart-1" },
                    { name: t("非缓存输入"), className: "bg-chart-3" },
                    { name: t("输出"), className: "bg-chart-5" },
                  ].map((item) => (
                    <li className="flex items-center gap-1.5" key={item.name}>
                      <span
                        className={cn("size-2 rounded-full", item.className)}
                      />
                      {item.name}
                    </li>
                  ))}
                  <li className="flex items-center gap-1.5">
                    <span className="h-px w-4 bg-emphasis-muted" />
                    {t("7 日均线")}
                  </li>
                </ul>
                <MachineValue
                  value={data.daily[data.daily.length - 1]?.date.slice(5) ?? ""}
                />
              </div>
            </div>
          </section>

          <Panel
            title={t("用量结构")}
            icon={LayersIcon}
            hint={t("缓存属于输入，推理属于输出")}
            className="col-span-12 self-start xl:col-span-4"
          >
            {/* Reads top down: the two totals, the proportion they make, then
                the parts each one breaks into. */}
            <dl className="grid grid-cols-2 gap-4">
              {[
                {
                  label: t("输入 Token"),
                  value: summary.inputTokens,
                  percent: share(summary.inputTokens, summary.totalTokens),
                },
                {
                  label: t("输出 Token"),
                  value: summary.outputTokens,
                  percent: share(summary.outputTokens, summary.totalTokens),
                },
              ].map((item) => (
                <Figure
                  key={item.label}
                  label={item.label}
                  value={formatTokens(item.value)}
                  note={`${item.percent.toFixed(0)}%`}
                />
              ))}
            </dl>

            <div className="my-3.5 flex h-2 overflow-hidden rounded-full bg-foreground/10">
              {composition.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    item.className,
                    "transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  )}
                  style={{
                    width: `${share(item.value, summary.totalTokens)}%`,
                  }}
                />
              ))}
            </div>

            <ul className="grid gap-3">
              {composition.map((item) => (
                <li
                  className="flex items-center gap-2 text-sm"
                  key={item.label}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      item.className
                    )}
                  />
                  <span className="truncate font-medium">{item.label}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                    {formatTokens(item.value)}
                  </span>
                  <span className="w-9 shrink-0 text-right font-medium tabular-nums">
                    {share(item.value, summary.totalTokens).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title={t("模型分布")}
            icon={CpuIcon}
            hint={t("{{count}} 项", { count: data.models.length })}
            className="col-span-12 md:col-span-6"
            bodyClassName="h-60"
          >
            <Ranking
              rows={data.models}
              scrollLabel={t("模型分布滚动区域")}
              listLabel={t("模型分布排名")}
              emptyTitle={t("暂无分布数据")}
              emptyDescription={t("当前筛选范围内没有可比较的数据。")}
            />
          </Panel>

          <Panel
            title={t("项目分布")}
            icon={FolderIcon}
            hint={t("{{count}} 项", { count: data.projects.length })}
            className="col-span-12 md:col-span-6"
            bodyClassName="h-60"
          >
            <Ranking
              rows={data.projects}
              scrollLabel={t("项目分布滚动区域")}
              listLabel={t("项目分布排名")}
              emptyTitle={t("暂无分布数据")}
              emptyDescription={t("当前筛选范围内没有可比较的数据。")}
            />
          </Panel>

          <Panel
            title={t("活跃热力图")}
            icon={ActivityIcon}
            hint={t("全部历史 · 不随筛选变化")}
            className="col-span-12 xl:col-span-8"
            bodyClassName="flex-1"
          >
            <div className="relative">
              <ScrollArea
                ref={heatmapScrollRef}
                className="h-36 [&_[data-slot=scroll-area-scrollbar]]:hidden"
                aria-label={t("活跃热力图滚动区域") as string}
              >
                <div
                  className="grid min-w-[38rem] gap-1 pr-2"
                  role="img"
                  aria-label={t("日期和小时 Token 热力图") as string}
                >
                  {heatRows.map((row) => (
                    <div className="flex items-center gap-1" key={row.date}>
                      <MachineValue
                        className="w-10 shrink-0 text-xs text-muted-foreground-subtle"
                        value={row.date.slice(5)}
                      />
                      <div className="grid flex-1 grid-cols-24 gap-1">
                        {row.hours.map((totalTokens, hour) => {
                          const level = heatMax ? totalTokens / heatMax : 0
                          const label = t(
                            "{{date}} {{hour}}:00 · {{tokens}} Token",
                            {
                              date: formatHeatmapDate(row.date),
                              hour: String(hour).padStart(2, "0"),
                              tokens: fullTokens(totalTokens),
                            }
                          )
                          return (
                            <Tooltip key={hour}>
                              <TooltipTrigger
                                aria-label={label}
                                render={
                                  <span
                                    className={cn(
                                      "h-3.5 rounded-[3px]",
                                      level === 0 && "bg-foreground/[0.06]",
                                      level > 0 &&
                                        level <= 0.25 &&
                                        "bg-chart-1",
                                      level > 0.25 &&
                                        level <= 0.5 &&
                                        "bg-chart-2",
                                      level > 0.5 &&
                                        level <= 0.75 &&
                                        "bg-chart-3",
                                      level > 0.75 && "bg-chart-5"
                                    )}
                                  />
                                }
                              />
                              <TooltipContent>{label}</TooltipContent>
                            </Tooltip>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-muted to-transparent transition-opacity duration-200 ease-out",
                  heatmapFade.top ? "opacity-100" : "opacity-0"
                )}
              />
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-muted to-transparent transition-opacity duration-200 ease-out",
                  heatmapFade.bottom ? "opacity-100" : "opacity-0"
                )}
              />
            </div>
            <div className="mt-2 flex items-center justify-between pl-11 text-xs text-muted-foreground-subtle">
              <span>0:00</span>
              <span>12:00</span>
              <span>23:00</span>
            </div>
            {/* The grid shows the shape; this says what the shape amounts to,
                and gives the panel a footer so it stops floating in dead space. */}
            <dl className="mt-auto grid grid-cols-3 gap-4 border-t border-border pt-3">
              {[
                {
                  label: t("最活跃日期"),
                  value: rhythm.busiestDate
                    ? formatHeatmapDate(rhythm.busiestDate)
                    : "—",
                },
                {
                  label: t("活跃天数"),
                  value: String(rhythm.activeDays),
                },
                {
                  label: t("周末占比"),
                  value: `${rhythm.weekendPercent.toFixed(0)}%`,
                },
              ].map((item) => (
                <Figure
                  key={item.label}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </dl>
          </Panel>

          <Panel
            title={t("工作负载")}
            icon={GaugeIcon}
            hint={t("同一筛选范围")}
            className="col-span-12 xl:col-span-4"
            bodyClassName="flex-1"
          >
            {/* One row per figure, the way the account cards list their facts:
                a two-column grid of six numbers left more air than it did work. */}
            <dl className="grid flex-1 content-between">
              {[
                {
                  icon: MessageSquareIcon,
                  label: t("会话"),
                  value: String(summary.sessions),
                },
                {
                  icon: PlayIcon,
                  label: t("任务启动"),
                  value: String(summary.tasksStarted),
                },
                {
                  icon: BadgeCheckIcon,
                  label: t("任务完成"),
                  value: String(summary.tasksCompleted),
                },
                {
                  icon: PercentIcon,
                  label: t("任务完成率"),
                  value: `${summary.completionPercent.toFixed(1)}%`,
                },
                {
                  icon: CircleOffIcon,
                  label: t("中止"),
                  value: String(summary.abortedTurns),
                },
                {
                  icon: FoldVerticalIcon,
                  label: t("上下文压缩"),
                  value: String(summary.compactions),
                },
              ].map((item) => (
                <Tally
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </dl>
          </Panel>

          {/* Coverage is reference material, not a comparison: it reads better
              as one wide short strip than as a tall column beside a wide chart,
              and every field fits without a scroll of its own. */}
          <Panel
            title={t("数据覆盖")}
            icon={DatabaseIcon}
            hint={t("白名单派生历史永久保留")}
            className="col-span-12"
          >
            <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {(
                [
                  [t("统计会话"), String(data.coverage.rollouts)],
                  [t("当前源文件"), String(data.coverage.sourceRollouts)],
                  [t("永久保留"), String(data.coverage.retainedRollouts)],
                  [
                    t("扫描完整性"),
                    t(data.coverage.scan.complete ? "完整" : "不完整"),
                  ],
                  [
                    t("待确认缺失"),
                    String(data.coverage.scan.pendingMissingRollouts),
                  ],
                  [t("解析警告"), String(data.coverage.parseWarnings)],
                  [t("最早事件"), formatDate(data.coverage.firstEventAt)],
                  [t("最新事件"), formatDate(data.coverage.lastEventAt)],
                  [
                    t("最近成功扫描"),
                    formatDate(data.coverage.scan.lastSuccessfulAt),
                  ],
                  [t("最近保留"), formatDate(data.coverage.lastRetentionAt)],
                  [
                    t("待同步审计"),
                    String(data.coverage.retention.pendingAuditEvents),
                  ],
                  [
                    t("审计最近校验"),
                    formatDate(data.coverage.retention.lastVerifiedAt),
                  ],
                  [t("快照状态"), t(data.coverage.backup.status)],
                  [
                    t("最近快照"),
                    formatDate(data.coverage.backup.lastSuccessfulAt),
                  ],
                  [t("快照代数"), String(data.coverage.backup.generations)],
                  [
                    t("最近数据库恢复"),
                    formatDate(data.coverage.backup.lastRecoveryAt),
                  ],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <Fact key={label} label={label} value={value} />
              ))}
            </dl>
          </Panel>

          <p className="col-span-12 flex items-center gap-1.5 px-1 text-xs text-muted-foreground-subtle">
            <InfoIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {data.coverage.firstEventAt
              ? t("本机数据始于 {{date}}；更早的本地记录不可恢复。", {
                  date: formatDay(data.coverage.firstEventAt),
                })
              : t("白名单派生历史永久保留，不会随 Codex 会话文件清理而删除。")}
          </p>
        </div>
      ) : data?.status === "scanning" ? (
        <LoadingDashboard />
      ) : null}
    </div>
  )
}
