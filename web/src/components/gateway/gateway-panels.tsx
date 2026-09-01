import {
  ActivityIcon,
  CircleOffIcon,
  ClockIcon,
  GaugeIcon,
  HourglassIcon,
  LayersIcon,
  RadioIcon,
  SlidersHorizontalIcon,
  TimerIcon,
  ZapIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Panel } from "@/components/app/panel"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDuration, formatLatency } from "@/lib/format"
import { Fact, Figure, Tally } from "@/components/app/figure"
import { cn } from "@/lib/utils"
import type {
  CodexStatusView,
  GatewaySnapshot,
  RequestLogsResponse,
  WebSocketConnectionView,
} from "@/services/contracts"

type Summary = RequestLogsResponse["summary"]
type TimelinePoint = RequestLogsResponse["timeline"][number]
type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * Connections are usually minutes old, not hours, so `formatDuration` would
 * report most of them as "0 小时 0 分钟". This matches the wording the
 * connection table already uses for the same quantity.
 */
function connectionAge(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return t("{{seconds}} 秒", { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return t("{{minutes}} 分 {{seconds}} 秒", {
      minutes,
      seconds: seconds % 60,
    })
  return t("{{hours}} 小时 {{minutes}} 分", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  })
}

const AVAILABILITY_BUCKETS = 96

/** Cached and uncached alike: one hue, darkest for the largest share. */
const OUTCOMES = [
  { key: "success", label: "成功", className: "bg-chart-4" },
  { key: "errors", label: "上游故障", className: "bg-chart-2" },
  { key: "rejected", label: "网关拒绝", className: "bg-chart-1" },
  { key: "cancelled", label: "客户端取消", className: "bg-foreground/20" },
] as const

export function RequestOutcomePanel({
  summary,
  enabled,
  className,
  busy,
}: {
  summary: Summary
  enabled: boolean
  className?: string
  busy?: boolean
}) {
  const { t } = useTranslation()
  const successful = Math.max(
    0,
    summary.availabilityRequests - summary.availabilityErrors
  )
  const total =
    summary.availabilityRequests + summary.rejected + summary.cancelled
  const parts = [
    { ...OUTCOMES[0], value: successful },
    { ...OUTCOMES[1], value: summary.availabilityErrors },
    { ...OUTCOMES[2], value: summary.rejected },
    { ...OUTCOMES[3], value: summary.cancelled },
  ]
  const share = (value: number) => (total ? (value / total) * 100 : 0)
  // Countable requests are a share of everything; successes are a share of the
  // countable ones, which is the same number the availability panel reports.
  const successRate = summary.availabilityRequests
    ? (successful / summary.availabilityRequests) * 100
    : 0

  return (
    <Panel
      title={t("请求结果构成")}
      icon={LayersIcon}
      hint={t("拒绝与取消不计入可用性")}
      className={className}
      busy={busy}
    >
      {!enabled ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("请求元数据记录已关闭，无法统计请求结果。")}
        </p>
      ) : (
        <>
          {/* Reads top down: the two totals, the proportion they make, then the
              parts each one breaks into. */}
          <dl className="grid grid-cols-2 gap-4">
            {[
              {
                label: t("有效请求"),
                value: summary.availabilityRequests,
                percent: share(summary.availabilityRequests),
              },
              {
                label: t("成功请求"),
                value: successful,
                percent: successRate,
              },
            ].map((item) => (
              <Figure
                key={item.label}
                label={item.label}
                value={item.value.toLocaleString()}
                note={`${item.percent.toFixed(1)}%`}
              />
            ))}
          </dl>

          <div className="my-3.5 flex h-2 overflow-hidden rounded-full bg-foreground/10">
            {parts.map((part) => (
              <span
                className={part.className}
                style={{ width: `${share(part.value)}%` }}
                key={part.key}
              />
            ))}
          </div>

          <ul className="grid gap-3">
            {parts.map((part) => (
              <li className="flex items-center gap-2 text-sm" key={part.key}>
                <span
                  className={cn("size-2 shrink-0 rounded-full", part.className)}
                />
                <span className="truncate font-medium">{t(part.label)}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  {part.value.toLocaleString()}
                </span>
                <span className="w-12 shrink-0 text-right font-medium tabular-nums">
                  {share(part.value).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

export function AvailabilityPanel({
  timeline,
  summary,
  enabled,
  from,
  to,
  action,
  className,
  busy,
}: {
  timeline: TimelinePoint[]
  summary: Summary
  enabled: boolean
  from: number
  to: number
  action?: React.ReactNode
  className?: string
  busy?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const size = Math.max(1, (to - from) / AVAILABILITY_BUCKETS)
  const buckets = Array.from({ length: AVAILABILITY_BUCKETS }, (_, index) => ({
    start: from + index * size,
    end: from + (index + 1) * size,
    points: [] as TimelinePoint[],
  }))
  for (const point of timeline) {
    const index = Math.floor((point.createdAt - from) / size)
    if (index >= 0 && index < buckets.length) buckets[index].points.push(point)
  }

  const successful = Math.max(
    0,
    summary.availabilityRequests - summary.availabilityErrors
  )
  const availability = summary.availabilityRequests
    ? (successful / summary.availabilityRequests) * 100
    : null

  return (
    <Panel
      title={t("API 可用性")}
      icon={ActivityIcon}
      className={className}
      busy={busy}
      action={
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">
            {availability === null ? "—" : `${availability.toFixed(1)}%`}
          </span>
          {action}
        </div>
      }
    >
      {!enabled ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("请求元数据记录已关闭，无法统计 API 可用性。")}
        </p>
      ) : (
        <>
          {/* A healthy bucket is the default state, so it wears the page's
              measurement blue rather than a badge of health; ninety-six cells
              of "all clear" would shout down the ones asking for attention. */}
          <div
            className="grid grid-cols-[repeat(96,minmax(0,1fr))] gap-0.5"
            role="group"
            aria-label={t("API 请求可用性阵列") as string}
          >
            {buckets.map((bucket) => {
              const errors = bucket.points.filter(
                (point) =>
                  point.outcome === "upstream_error" ||
                  point.outcome === "gateway_error"
              ).length
              const rejected = bucket.points.filter(
                (point) => point.outcome === "rejected"
              ).length
              const cancelled = bucket.points.filter(
                (point) => point.outcome === "client_cancelled"
              ).length
              const average = bucket.points.length
                ? bucket.points.reduce(
                    (sum, point) => sum + point.durationMs,
                    0
                  ) / bucket.points.length
                : null
              // Rejections are the gateway refusing, not the upstream
              // failing, and the panel already excludes them from the
              // percentage — colouring cells with them turned a day of
              // ordinary traffic into a wall of amber.
              const state =
                bucket.points.length === 0 || cancelled === bucket.points.length
                  ? "empty"
                  : errors >= bucket.points.length / 2
                    ? "error"
                    : errors > 0
                      ? "mixed"
                      : "success"
              const cell = (
                <span
                  data-slot="availability-bucket"
                  data-availability-state={state}
                  className={cn(
                    "h-6 min-w-0 rounded-sm",
                    state === "empty" && "bg-foreground/[0.08]",
                    state === "success" && "bg-chart-3",
                    state === "mixed" && "bg-warning",
                    state === "error" && "bg-destructive"
                  )}
                />
              )
              // An empty bucket has nothing to report, so only buckets with
              // traffic carry a tooltip.
              return state === "empty" ? (
                <span key={bucket.start}>{cell}</span>
              ) : (
                <Tooltip key={bucket.start}>
                  <TooltipTrigger render={cell} />
                  <TooltipContent>
                    {t(
                      "{{time}} · 请求 {{requests}} · 故障 {{errors}} · 拒绝 {{rejected}} · 平均 {{average}}",
                      {
                        time: new Date(bucket.start).toLocaleString(locale),
                        requests: bucket.points.length,
                        errors,
                        rejected,
                        average: formatLatency(average),
                      }
                    )}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground-subtle tabular-nums">
            <span>{new Date(from).toLocaleString(locale)}</span>
            <span>{t("现在")}</span>
          </div>

          {/* The strip shows the shape; this says what the shape amounts to. */}
          <dl className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 sm:grid-cols-3 xl:grid-cols-5">
            {[
              [t("统计请求"), summary.availabilityRequests.toLocaleString()],
              [t("故障"), summary.availabilityErrors.toLocaleString()],
              [t("拒绝"), summary.rejected.toLocaleString()],
              [t("取消"), summary.cancelled.toLocaleString()],
              [t("平均耗时"), formatLatency(summary.averageDurationMs)],
            ].map(([label, value]) => (
              <Figure key={label} label={label} value={value} />
            ))}
          </dl>
        </>
      )}
    </Panel>
  )
}

export function ConnectionSummaryPanel({
  connections,
  now,
  className,
}: {
  connections: WebSocketConnectionView[]
  now: number
  className?: string
}) {
  const { t } = useTranslation()
  const count = (state: WebSocketConnectionView["state"]) =>
    connections.filter((connection) => connection.state === state).length
  const ages = connections.map((connection) =>
    Math.max(0, now - connection.connectedAt)
  )
  const average = ages.length
    ? ages.reduce((sum, value) => sum + value, 0) / ages.length
    : null
  const longest = ages.length ? Math.max(...ages) : null

  const rows = [
    {
      icon: RadioIcon,
      label: t("连接总数"),
      value: String(connections.length),
    },
    {
      icon: ZapIcon,
      label: t("正在传输"),
      value: String(count("transmitting")),
    },
    {
      icon: HourglassIcon,
      label: t("连接中"),
      value: String(count("connecting")),
    },
    {
      icon: CircleOffIcon,
      label: t("正在退役"),
      value: String(count("retiring")),
    },
    {
      icon: TimerIcon,
      label: t("平均连接时长"),
      value: average === null ? "—" : connectionAge(average, t),
    },
    {
      icon: ClockIcon,
      label: t("最长连接时长"),
      value: longest === null ? "—" : connectionAge(longest, t),
    },
  ]

  return (
    <Panel
      title={t("连接概览")}
      icon={GaugeIcon}
      hint={t("实时")}
      className={className}
      bodyClassName="flex-1"
    >
      {/* One row per figure, the way the account cards list their facts: a
          two-column grid of six numbers left more air than it did work. */}
      <dl className="grid flex-1 content-between">
        {rows.map((row) => (
          <Tally
            key={row.label}
            icon={row.icon}
            label={row.label}
            value={row.value}
          />
        ))}
      </dl>
    </Panel>
  )
}

export function RuntimeEnvironmentPanel({
  snapshot,
  status,
  className,
}: {
  snapshot: GatewaySnapshot
  status: CodexStatusView
  className?: string
}) {
  const { t } = useTranslation()
  const { health, settings, stats } = snapshot
  const facts: Array<[string, string]> = [
    [t("监听地址"), `${settings.gatewayAddress}:${settings.gatewayPort}`],
    [t("Router 入口"), status.gatewayBaseUrl],
    [t("上游"), settings.upstream],
    [t("当前 openai_base_url"), status.openaiBaseUrl ?? "—"],
    [t("Router 版本"), health.version],
    [t("已运行"), formatDuration(stats.uptimeSeconds)],
    [t("Codex 进程"), t(status.codexRunning ? "正在运行" : "当前未运行")],
    [t("配置文件"), status.configPath],
    [t("备份文件"), status.hasBackup ? status.backupPath : t("尚未备份")],
    [t("配置已改写"), t(status.applied ? "是" : "否")],
    [t("今日请求"), stats.requestsToday.toLocaleString()],
    [t("今日错误"), stats.errorsToday.toLocaleString()],
    [t("就绪账号"), `${stats.accountsReady} / ${health.accounts}`],
    [t("元数据记录"), t(settings.requestMetadataLogging ? "已开启" : "已关闭")],
    [t("日志级别"), settings.logLevel],
    [t("数据目录"), health.dataDir],
    [t("数据库"), health.databasePath],
    [t("日志文件"), health.logFilePath ?? "—"],
  ]

  return (
    <Panel
      title={t("运行环境")}
      icon={SlidersHorizontalIcon}
      hint={t("配置由 Codex Router 写入并可随时恢复")}
      className={className}
    >
      {/* Reference material, not a comparison: one short wide strip reads
          better than a tall column, and every field fits without a scroll. */}
      <dl className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </dl>
    </Panel>
  )
}
