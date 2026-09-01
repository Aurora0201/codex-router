import { RadioTowerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Panel } from "@/components/app/panel"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { WebSocketConnectionLogsResponse } from "@/services/contracts"

type Summary = WebSocketConnectionLogsResponse["summary"]
type Bucket = WebSocketConnectionLogsResponse["histogram"][number]

function bucketState(bucket: Bucket): "empty" | "healthy" | "mixed" | "error" {
  if (bucket.connections === 0) return "empty"
  if (bucket.failures >= bucket.connections / 2) return "error"
  return bucket.failures > 0 ? "mixed" : "healthy"
}

export function ConnectionVolumeHero({
  summary,
  histogram,
  rangeLabel,
  onSelectWindow,
  className,
}: {
  summary: Summary
  histogram: Bucket[]
  rangeLabel: string
  onSelectWindow(from: number, to: number): void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const peak = Math.max(1, ...histogram.map((bucket) => bucket.connections))
  const healthyRate = summary.connections
    ? ((summary.connections - summary.failures) / summary.connections) * 100
    : null
  const other = Math.max(
    0,
    summary.connections - summary.failures - summary.retired
  )
  const figures = [
    { label: t("失败 / 拒绝"), value: summary.failures },
    { label: t("正常退役"), value: summary.retired },
    { label: t("其他连接"), value: other },
  ]

  return (
    <section
      className={cn(
        "flex flex-col rounded-2xl bg-emphasis p-2 text-emphasis-foreground",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs text-emphasis-muted">
            {t("{{range}}的连接", { range: rangeLabel })}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="font-brand text-3xl leading-none font-semibold tabular-nums">
              {summary.connections.toLocaleString(locale)}
            </span>
            {healthyRate === null ? null : (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  summary.failures > 0
                    ? "text-emphasis-warning"
                    : "text-emphasis-success"
                )}
              >
                {t("{{percent}}% 无故障", {
                  percent: healthyRate.toFixed(1),
                })}
              </span>
            )}
          </p>
        </div>
        <ul className="flex shrink-0 gap-6 text-right">
          {figures.map((figure) => (
            <li key={figure.label}>
              <p className="text-xs text-emphasis-muted">{figure.label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {figure.value.toLocaleString(locale)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-1 flex-col rounded-xl bg-emphasis-surface p-3">
        <div
          className="flex min-h-24 flex-1 items-end gap-0.5"
          role="group"
          aria-label={t("连接量与结果的时间分布") as string}
        >
          {histogram.map((bucket) => {
            const state = bucketState(bucket)
            if (state === "empty")
              return (
                <span
                  className="min-w-0 flex-1 rounded-[2px] bg-emphasis-muted/25"
                  style={{ height: "4%" }}
                  key={bucket.startedAt}
                />
              )
            const bar = (
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 rounded-[2px] transition-transform outline-none",
                  "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-emphasis-foreground/60 motion-reduce:transition-none",
                  state === "healthy" && "bg-chart-3",
                  state === "mixed" && "bg-emphasis-warning",
                  state === "error" && "bg-emphasis-destructive"
                )}
                style={{
                  height: `${Math.max((bucket.connections / peak) * 100, 4)}%`,
                }}
                onClick={() => onSelectWindow(bucket.startedAt, bucket.endedAt)}
                aria-label={t(
                  "{{time}} · 连接 {{connections}} · 故障 {{failures}}",
                  {
                    time: new Date(bucket.startedAt).toLocaleString(locale),
                    connections: bucket.connections,
                    failures: bucket.failures,
                  }
                )}
              />
            )
            return (
              <Tooltip key={bucket.startedAt}>
                <TooltipTrigger render={bar} />
                <TooltipContent>
                  {t(
                    "{{time}} · 连接 {{connections}} · 故障 {{failures}} · 退役 {{retired}}",
                    {
                      time: new Date(bucket.startedAt).toLocaleString(locale),
                      connections: bucket.connections,
                      failures: bucket.failures,
                      retired: bucket.retired,
                    }
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <p className="mt-2 flex items-center justify-between gap-3 text-xs text-emphasis-muted tabular-nums">
          <span>
            {histogram[0]
              ? new Date(histogram[0].startedAt).toLocaleString(locale)
              : "—"}
          </span>
          <span className="truncate">
            {t("点选任意一格，把下方连接列表收窄到该时段")}
          </span>
          <span>{t("现在")}</span>
        </p>
      </div>
    </section>
  )
}

export function ConnectionOutcomePanel({
  summary,
  className,
}: {
  summary: Summary
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const other = Math.max(
    0,
    summary.connections - summary.failures - summary.retired
  )
  const peak = Math.max(1, summary.failures, summary.retired, other)
  const outcomes = [
    { label: t("其他连接"), count: other, color: "bg-chart-3" },
    { label: t("正常退役"), count: summary.retired, color: "bg-chart-2" },
    {
      label: t("失败 / 拒绝"),
      count: summary.failures,
      color: "bg-destructive",
    },
  ]

  return (
    <Panel
      title={t("连接结果分布")}
      icon={RadioTowerIcon}
      hint={t("共 {{count}} 次", { count: summary.connections })}
      className={className}
      bodyClassName="xl:min-h-0 xl:flex-1 xl:overflow-y-auto"
    >
      {summary.connections === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("这段范围内没有连接")}
        </p>
      ) : (
        <ul className="grid gap-4">
          {outcomes.map((outcome) => (
            <li className="grid gap-1.5" key={outcome.label}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate font-medium">{outcome.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {outcome.count.toLocaleString(locale)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className={cn("h-full rounded-full", outcome.color)}
                  style={{ width: `${(outcome.count / peak) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
