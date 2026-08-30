import { useEffect, useMemo, useState } from "react"
import { AlertTriangleIcon, DatabaseIcon, InfoIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Bar, ComposedChart, Line } from "recharts"

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
  rollingAverage7d: { label: "7 日均线", color: "var(--ink-muted)" },
} satisfies ChartConfig

const ranges: Array<{ value: CodexUsageRange; label: string }> = [
  { value: "7d", label: "最近 7 天" },
  { value: "14d", label: "最近 14 天" },
  { value: "30d", label: "最近 30 天" },
  { value: "90d", label: "最近 90 天" },
  { value: "all", label: "全部历史" },
]
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const weekdayLabels: Record<string, string> = {
  Mon: "一",
  Tue: "二",
  Wed: "三",
  Thu: "四",
  Fri: "五",
  Sat: "六",
  Sun: "日",
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
function isProjectIdentifier(key: string): boolean {
  return key !== "uncategorized-conversation" && key !== "other"
}
function share(part: number, whole: number): number {
  return whole ? (part / whole) * 100 : 0
}

/** Every block is the same shell: a card wrapping one solid inset. */
function Panel({
  title,
  hint,
  className,
  bodyClassName,
  children,
}: {
  title: string
  hint?: string
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl bg-card p-2 ring-1 ring-foreground/10",
        className
      )}
    >
      <header className="flex items-baseline justify-between gap-4 px-2 py-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? (
          <span className="truncate text-xs text-muted-foreground/70">
            {hint}
          </span>
        ) : null}
      </header>
      {/* flex-1 would set flex-basis:0 and beat any height a caller asks for,
          so stretching is opt-in rather than baked into the shell. */}
      <div
        className={cn("flex flex-col rounded-xl bg-muted p-3", bodyClassName)}
      >
        {children}
      </div>
    </section>
  )
}

function Ranking({
  rows,
  scrollLabel,
  listLabel,
  emptyTitle,
  emptyDescription,
  mono,
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
  mono?: (key: string) => boolean
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
    <ScrollArea className="h-full" aria-label={scrollLabel}>
      <ul className="grid gap-3 pr-2" aria-label={listLabel}>
        {rows.map((row) => (
          <li className="grid gap-1.5" key={row.key}>
            <div className="flex items-baseline justify-between gap-4 text-xs">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className={cn(
                        "min-w-0 truncate rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        mono?.(row.key) && "font-mono"
                      )}
                    />
                  }
                >
                  {row.label}
                </TooltipTrigger>
                <TooltipContent className="max-w-sm break-all">
                  {row.label}
                </TooltipContent>
              </Tooltip>
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
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
                className="h-full rounded-full bg-chart-4"
                style={{ width: `${Math.max(row.share * 100, 1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </ScrollArea>
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
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState(0)

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
    return () => {
      cancelled = true
    }
  }, [service, range, model, project, revision, request])

  const heat = useMemo(
    () =>
      new Map(
        data?.heatmap.map((item) => [
          `${item.weekday}|${item.hour}`,
          item.totalTokens,
        ]) ?? []
      ),
    [data]
  )
  const heatMax = Math.max(0, ...heat.values())
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
      <div className="flex rounded-xl bg-card p-1 ring-1 ring-foreground/10">
        {ranges.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={item.value === range}
            className={cn(
              "h-7 rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              item.value === range
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setRange(item.value)}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <Select value={model} onValueChange={(value) => value && setModel(value)}>
        <SelectTrigger
          className="h-9 w-44 rounded-xl"
          aria-label={t("模型筛选")}
        >
          <SelectValue className={cn(model !== "all" && "font-mono")}>
            {model === "all" ? t("全部模型") : model}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">{t("全部模型")}</SelectItem>
            {data?.filters.models.map((item) => (
              <SelectItem className="font-mono" key={item} value={item}>
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
              className="h-9 w-full min-w-0 overflow-hidden rounded-xl"
              aria-label={t("项目筛选")}
            >
              <SelectValue
                className={cn(
                  "min-w-0 overflow-hidden",
                  selectedProject &&
                    isProjectIdentifier(selectedProject.key) &&
                    "font-mono"
                )}
              >
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
                className={cn(
                  "max-w-full min-w-0 overflow-hidden [&>span:first-child]:min-w-0 [&>span:first-child]:shrink [&>span:first-child]:overflow-hidden",
                  isProjectIdentifier(item.key) && "font-mono"
                )}
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
        <div className="grid grid-cols-12 gap-4">
          {/* The one dark block on the page: the headline number and its shape.
              Everything else stays on light surfaces so this reads as the hero. */}
          <section className="col-span-12 rounded-2xl bg-ink p-2 text-ink-foreground xl:col-span-8">
            <div className="flex flex-wrap items-start justify-between gap-4 px-3 py-2.5">
              <div>
                <p className="text-xs text-ink-muted">{t("区间总 Token")}</p>
                <p
                  className="mt-1 font-brand text-3xl leading-none font-semibold tabular-nums"
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
                    <p className="text-xs text-ink-muted">{item.label}</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {item.value}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-ink-panel p-3">
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
                        formatter={(value, name) => (
                          <div className="flex min-w-36 justify-between gap-3">
                            <span className="text-muted-foreground">
                              {
                                trendConfig[name as keyof typeof trendConfig]
                                  ?.label
                              }
                            </span>
                            <span className="font-mono tabular-nums">
                              {fullTokens(Number(value))}
                            </span>
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar
                    dataKey="cachedInputTokens"
                    stackId="tokens"
                    fill="var(--color-cachedInputTokens)"
                  />
                  <Bar
                    dataKey="uncachedInputTokens"
                    stackId="tokens"
                    fill="var(--color-uncachedInputTokens)"
                  />
                  <Bar
                    dataKey="outputTokens"
                    stackId="tokens"
                    fill="var(--color-outputTokens)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Line
                    dataKey="rollingAverage7d"
                    type="monotone"
                    stroke="var(--color-rollingAverage7d)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                </ComposedChart>
              </ChartContainer>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-muted">
                <span className="font-mono tabular-nums">
                  {data.daily[0]?.date.slice(5)}
                </span>
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
                    <span className="h-px w-4 bg-ink-muted" />
                    {t("7 日均线")}
                  </li>
                </ul>
                <span className="font-mono tabular-nums">
                  {data.daily[data.daily.length - 1]?.date.slice(5)}
                </span>
              </div>
            </div>
          </section>

          <Panel
            title={t("用量结构")}
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
                <div key={item.label}>
                  <dt className="text-[11px] text-muted-foreground/70">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-lg leading-none font-semibold tabular-nums">
                      {formatTokens(item.value)}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {item.percent.toFixed(0)}%
                    </span>
                  </dd>
                </div>
              ))}
            </dl>

            <div className="my-3.5 flex h-2 overflow-hidden rounded-full bg-foreground/10">
              {composition.map((item) => (
                <span
                  key={item.label}
                  className={item.className}
                  style={{
                    width: `${share(item.value, summary.totalTokens)}%`,
                  }}
                />
              ))}
            </div>

            <ul className="grid gap-3">
              {composition.map((item) => (
                <li
                  className="flex items-center gap-2 text-xs"
                  key={item.label}
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      item.className
                    )}
                  />
                  <span className="truncate font-medium">{item.label}</span>
                  <span className="ml-auto shrink-0 font-mono text-muted-foreground tabular-nums">
                    {formatTokens(item.value)}
                  </span>
                  <span className="w-9 shrink-0 text-right text-muted-foreground/70 tabular-nums">
                    {share(item.value, summary.totalTokens).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title={t("模型分布")}
            hint={t("{{count}} 项", { count: data.models.length })}
            className="col-span-12 md:col-span-6"
            bodyClassName="h-60"
          >
            <Ranking
              rows={data.models}
              scrollLabel={t("模型分布滚动区域")}
              listLabel={t("模型分布排名")}
              mono={() => true}
              emptyTitle={t("暂无分布数据")}
              emptyDescription={t("当前筛选范围内没有可比较的数据。")}
            />
          </Panel>

          <Panel
            title={t("项目分布")}
            hint={t("{{count}} 项", { count: data.projects.length })}
            className="col-span-12 md:col-span-6"
            bodyClassName="h-60"
          >
            <Ranking
              rows={data.projects}
              scrollLabel={t("项目分布滚动区域")}
              listLabel={t("项目分布排名")}
              mono={isProjectIdentifier}
              emptyTitle={t("暂无分布数据")}
              emptyDescription={t("当前筛选范围内没有可比较的数据。")}
            />
          </Panel>

          <Panel
            title={t("活跃热力图")}
            hint={t("按本机时区，星期 × 小时")}
            className="col-span-12 xl:col-span-8"
            bodyClassName="flex-1"
          >
            <ScrollArea aria-label={t("活跃热力图滚动区域") as string}>
              <div
                className="grid min-w-[38rem] gap-1"
                role="img"
                aria-label={t("星期和小时 Token 热力图") as string}
              >
                {weekdays.map((day) => (
                  <div className="flex items-center gap-1" key={day}>
                    <span className="w-4 shrink-0 text-[11px] text-muted-foreground/70">
                      {weekdayLabels[day]}
                    </span>
                    <div className="grid flex-1 grid-cols-24 gap-1">
                      {Array.from({ length: 24 }, (_, hour) => {
                        const value = heat.get(`${day}|${hour}`) ?? 0
                        const level = heatMax ? value / heatMax : 0
                        return (
                          <span
                            key={hour}
                            title={`${weekdayLabels[day]} ${hour}:00 · ${fullTokens(value)}`}
                            className={cn(
                              "h-3.5 rounded-[3px]",
                              level === 0 && "bg-foreground/[0.06]",
                              level > 0 && level <= 0.25 && "bg-chart-1",
                              level > 0.25 && level <= 0.5 && "bg-chart-2",
                              level > 0.5 && level <= 0.75 && "bg-chart-3",
                              level > 0.75 && "bg-chart-5"
                            )}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="mt-2 flex items-center justify-between pl-5 text-[11px] text-muted-foreground/70">
              <span>0:00</span>
              <span>12:00</span>
              <span>23:00</span>
            </div>
          </Panel>

          <Panel
            title={t("工作负载与覆盖")}
            hint={t("同一筛选范围")}
            className="col-span-12 xl:col-span-4"
            bodyClassName="min-h-0 flex-1"
          >
            <dl className="grid shrink-0 grid-cols-2 content-start gap-x-4 gap-y-3.5">
              {[
                { label: t("会话"), value: summary.sessions },
                { label: t("任务启动"), value: summary.tasksStarted },
                { label: t("任务完成"), value: summary.tasksCompleted },
                {
                  label: t("任务完成率"),
                  value: `${summary.completionPercent.toFixed(1)}%`,
                },
                { label: t("中止"), value: summary.abortedTurns },
                { label: t("上下文压缩"), value: summary.compactions },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-[11px] text-muted-foreground/70">
                    {item.label}
                  </dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                <DatabaseIcon aria-hidden="true" className="size-3" />
                {t("数据覆盖")}
              </p>
              {/* The full diagnostic set stays available; the panel scrolls
                  rather than dropping the rarely-read half of it. */}
              <ScrollArea
                className="min-h-24 flex-1"
                aria-label={t("数据覆盖滚动区域") as string}
              >
                <dl className="grid gap-2 pr-2">
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
                      [
                        t("最近保留"),
                        formatDate(data.coverage.lastRetentionAt),
                      ],
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
                    <div
                      className="flex justify-between gap-3 text-xs"
                      key={label}
                    >
                      <dt className="truncate text-muted-foreground">
                        {label}
                      </dt>
                      <dd
                        className="min-w-0 shrink-0 truncate font-mono font-medium tabular-nums"
                        title={value}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </ScrollArea>
            </div>
          </Panel>

          <p className="col-span-12 flex items-center gap-1.5 px-1 text-xs text-muted-foreground/70">
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
