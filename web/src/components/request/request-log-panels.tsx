import { ServerCrashIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Panel } from "@/components/app/panel"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatLatency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { FailureSource, RequestLogsResponse } from "@/services/contracts"

type Summary = RequestLogsResponse["summary"]
type Bucket = RequestLogsResponse["histogram"][number]

const SOURCE_LABELS: Record<FailureSource, string> = {
  gateway: "网关",
  upstream_http: "上游 HTTP",
  upstream_protocol: "上游协议",
  transport: "传输",
  client: "客户端",
}

function bucketState(bucket: Bucket): "empty" | "success" | "mixed" | "error" {
  if (bucket.requests === 0) return "empty"
  if (bucket.errors >= bucket.requests / 2) return "error"
  return bucket.errors > 0 ? "mixed" : "success"
}

/**
 * The one emphasis block on the page. A log page's headline is not a total but
 * where in the window things went wrong, so bar height is how busy that bucket
 * was and bar colour is how it went: one bar answers "when" and "how bad".
 */
export function RequestVolumeHero({
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
  const peak = Math.max(1, ...histogram.map((bucket) => bucket.requests))
  const successRate = summary.availabilityRequests
    ? ((summary.availabilityRequests - summary.availabilityErrors) /
        summary.availabilityRequests) *
      100
    : null
  const first = histogram.at(0)
  const figures = [
    { label: t("故障"), value: summary.errors.toLocaleString(locale) },
    { label: t("拒绝"), value: summary.rejected.toLocaleString(locale) },
    { label: t("取消"), value: summary.cancelled.toLocaleString(locale) },
    { label: t("平均耗时"), value: formatLatency(summary.averageDurationMs) },
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
            {t("{{range}}的请求", { range: rangeLabel })}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="font-brand text-3xl leading-none font-semibold tabular-nums">
              {summary.requests.toLocaleString(locale)}
            </span>
            {successRate === null ? null : (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  summary.errors > 0
                    ? "text-emphasis-warning"
                    : "text-emphasis-success"
                )}
              >
                {t("{{percent}}% 成功", { percent: successRate.toFixed(1) })}
              </span>
            )}
          </p>
        </div>
        <ul className="flex shrink-0 gap-6 text-right">
          {figures.map((figure) => (
            <li key={figure.label}>
              <p className="text-xs text-emphasis-muted">{figure.label}</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {figure.value}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-1 flex-col rounded-xl bg-emphasis-surface p-3">
        <div
          className="flex min-h-24 flex-1 items-end gap-0.5"
          role="group"
          aria-label={t("请求量与结果的时间分布") as string}
        >
          {histogram.map((bucket) => {
            const state = bucketState(bucket)
            const bar = (
              <button
                type="button"
                // A healthy bucket is the default state, so it wears the
                // page's measurement blue; ninety-six cells of "all clear" in
                // green would shout down the ones worth clicking.
                className={cn(
                  "min-w-0 flex-1 rounded-[2px] transition-transform outline-none",
                  "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-emphasis-foreground/60 motion-reduce:transition-none",
                  state === "empty" && "cursor-default bg-emphasis-muted/25",
                  state === "success" && "bg-chart-3",
                  state === "mixed" && "bg-emphasis-warning",
                  state === "error" && "bg-emphasis-destructive"
                )}
                style={{
                  height: `${Math.max((bucket.requests / peak) * 100, 4)}%`,
                }}
                disabled={state === "empty"}
                onClick={() => onSelectWindow(bucket.startedAt, bucket.endedAt)}
                aria-label={t(
                  "{{time}} · 请求 {{requests}} · 故障 {{errors}}",
                  {
                    time: new Date(bucket.startedAt).toLocaleString(locale),
                    requests: bucket.requests,
                    errors: bucket.errors,
                  }
                )}
              />
            )
            // An empty bucket has nothing to report and nothing to narrow to.
            return state === "empty" ? (
              <span
                className="min-w-0 flex-1 rounded-[2px] bg-emphasis-muted/25"
                style={{ height: "4%" }}
                key={bucket.startedAt}
              />
            ) : (
              <Tooltip key={bucket.startedAt}>
                <TooltipTrigger render={bar} />
                <TooltipContent>
                  {t(
                    "{{time}} · 请求 {{requests}} · 故障 {{errors}} · 拒绝 {{rejected}}",
                    {
                      time: new Date(bucket.startedAt).toLocaleString(locale),
                      requests: bucket.requests,
                      errors: bucket.errors,
                      rejected: bucket.rejected,
                    }
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <p className="mt-2 flex items-center justify-between gap-3 text-xs text-emphasis-muted tabular-nums">
          <span>
            {first ? new Date(first.startedAt).toLocaleString(locale) : "—"}
          </span>
          {/* The strip is the fastest filter on the page, so it says so. */}
          <span className="truncate">
            {t("点选任意一格，把下方列表收窄到那一段")}
          </span>
          <span>{t("现在")}</span>
        </p>
      </div>
    </section>
  )
}

export function FailureBreakdownPanel({
  summary,
  failureSources,
  diagnosticCodes,
  onSelectSource,
  onSelectCode,
  className,
}: {
  summary: Summary
  failureSources: RequestLogsResponse["failureSources"]
  diagnosticCodes: RequestLogsResponse["diagnosticCodes"]
  onSelectSource(source: FailureSource): void
  onSelectCode(code: string): void
  className?: string
}) {
  const { t } = useTranslation()
  const worst = Math.max(1, ...failureSources.map((item) => item.count))
  // A bar is a comparison. With one source — or with every source on the same
  // count — it can only draw a full row, which says nothing the number beside
  // it has not already said.
  const comparable =
    failureSources.length > 1 &&
    failureSources.some((item) => item.count !== worst)

  return (
    <Panel
      title={t("故障分布")}
      icon={ServerCrashIcon}
      hint={t("共 {{count}} 次", { count: summary.errors })}
      className={className}
      bodyClassName="xl:min-h-0 xl:flex-1 xl:overflow-y-auto"
    >
      {failureSources.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("这段范围内没有故障")}
        </p>
      ) : (
        <ul className="grid gap-3">
          {failureSources.map((item) => (
            <li className="grid gap-1.5" key={item.source}>
              <button
                type="button"
                className="flex items-baseline justify-between gap-3 rounded-sm text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onSelectSource(item.source)}
              >
                <span className="truncate font-medium">
                  {t(SOURCE_LABELS[item.source] ?? item.source)}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {item.count}
                </span>
              </button>
              {comparable ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <div
                    className="h-full rounded-full bg-chart-4 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{ width: `${(item.count / worst) * 100}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* The source says which layer broke; the code is what you would put in
          the search box next, so it is the one worth naming. */}
      {diagnosticCodes.length ? (
        <dl className="mt-4 grid gap-2 border-t border-border pt-3">
          <dt className="text-xs text-muted-foreground-subtle">
            {t("最常见诊断码")}
          </dt>
          {diagnosticCodes.map((item) => (
            <dd key={item.code}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 rounded-sm text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => onSelectCode(item.code)}
              >
                <span className="truncate font-mono">{item.code}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {item.count}
                </span>
              </button>
            </dd>
          ))}
        </dl>
      ) : null}
    </Panel>
  )
}
