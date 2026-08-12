import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { GatewayService, RequestLogRange, RequestLogsResponse } from "@/services/contracts"

type TimelinePoint = RequestLogsResponse["timeline"][number]

const AVAILABILITY_BUCKETS = 96
const EMPTY_AVAILABILITY = {
  timeline: [] as TimelinePoint[],
  summary: { availabilityRequests: 0, availabilityErrors: 0, rejected: 0, cancelled: 0 },
}

const rangeDuration: Record<RequestLogRange, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
}

export function RequestAvailabilityCard({
  service,
  enabled,
  revision,
}: {
  service: GatewayService
  enabled: boolean
  revision: number
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const [range, setRange] = useState<RequestLogRange>("24h")
  const [end, setEnd] = useState(() => Date.now())
  const [data, setData] = useState(EMPTY_AVAILABILITY)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void service.getRequestLogs({ range, page: 1, limit: 1 }).then((result) => {
      if (cancelled) return
      setData({ timeline: result.timeline, summary: result.summary })
      setEnd(Date.now())
    }).catch((error) => {
      if (!cancelled) toast.add({ title: t("请求日志载入失败"), description: (error as Error).message, type: "error" })
    })
    return () => { cancelled = true }
  }, [enabled, range, revision, service, t])

  const displayedData = enabled ? data : EMPTY_AVAILABILITY
  const duration = rangeDuration[range]
  const start = end - duration
  const bucketSize = duration / AVAILABILITY_BUCKETS
  const buckets = Array.from({ length: AVAILABILITY_BUCKETS }, (_, index) => ({
    start: start + index * bucketSize,
    end: start + (index + 1) * bucketSize,
    points: [] as TimelinePoint[],
  }))
  for (const point of displayedData.timeline) {
    const index = Math.floor((point.createdAt - start) / bucketSize)
    if (index >= 0 && index < buckets.length) buckets[index].points.push(point)
  }

  const { availabilityRequests, availabilityErrors, rejected, cancelled } = displayedData.summary
  const successful = Math.max(0, availabilityRequests - availabilityErrors)
  const availability = availabilityRequests === 0 ? null : successful / availabilityRequests * 100
  const timeTicks = Array.from({ length: 5 }, (_, index) => start + duration * index / 4)

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>{t("API 可用性")}</CardTitle>
        <CardDescription>
          {!enabled
            ? t("请求元数据记录已关闭，无法统计 API 可用性。")
            : t("从左到右按时间排列，每格汇总请求结果与平均耗时；成功 {{successful}} / 有效 {{available}}。", { successful, available: availabilityRequests })}
          {enabled && (rejected > 0 || cancelled > 0) ? ` ${t("拒绝 {{rejected}} · 取消 {{cancelled}} 不计入。", { rejected, cancelled })}` : null}
        </CardDescription>
        <CardAction className="flex items-center gap-3">
          <span className="text-base leading-snug font-medium tabular-nums">{availability == null ? "—" : `${availability.toFixed(1)}%`}</span>
          <Select value={range} onValueChange={(value) => {
            if (!value || value === range) return
            setData(EMPTY_AVAILABILITY)
            setEnd(Date.now())
            setRange(value as RequestLogRange)
          }}>
            <SelectTrigger className="w-32" aria-label={t("时间范围")}><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>
              <SelectItem value="1h">{t("最近 1 小时")}</SelectItem>
              <SelectItem value="24h">{t("最近 24 小时")}</SelectItem>
              <SelectItem value="7d">{t("最近 7 天")}</SelectItem>
            </SelectGroup></SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(96,minmax(0,1fr))] gap-0.5" role="group" aria-label={t("API 请求可用性阵列")}>
          {buckets.map((bucket) => {
            const errors = bucket.points.filter((point) => point.outcome === "upstream_error" || point.outcome === "gateway_error").length
            const warnings = bucket.points.filter((point) => point.outcome === "rejected").length
            const successes = bucket.points.filter((point) => point.outcome === "success").length
            const cancelledCount = bucket.points.filter((point) => point.outcome === "client_cancelled").length
            const average = bucket.points.length ? Math.round(bucket.points.reduce((sum, point) => sum + point.durationMs, 0) / bucket.points.length) : null
            const state = bucket.points.length === 0 || cancelledCount === bucket.points.length ? "empty" : errors > 0 && successes === 0 && warnings === 0 ? "error" : errors > 0 || warnings > 0 ? "mixed" : "success"
            const label = t("{{time}}，{{requests}} 个请求，{{errors}} 个故障，{{rejected}} 个拒绝，{{cancelled}} 个取消", { time: new Date(bucket.start).toLocaleString(locale), requests: bucket.points.length, errors, rejected: warnings, cancelled: cancelledCount })
            return (
              <Tooltip key={bucket.start}>
                <TooltipTrigger render={<span tabIndex={0} role="img" aria-label={label} data-slot="availability-bucket" data-availability-state={state} className={cn("h-4 min-w-0 rounded-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", state === "empty" && "bg-muted", state === "success" && "bg-success/80", state === "mixed" && "bg-warning/85", state === "error" && "bg-destructive/85")} />} />
                <TooltipContent><div className="flex flex-col gap-1 text-xs"><span>{new Date(bucket.start).toLocaleString(locale)} – {new Date(bucket.end).toLocaleTimeString(locale)}</span><span className="tabular-nums">{t("请求 {{requests}} · 故障 {{errors}} · 拒绝 {{rejected}} · 取消 {{cancelled}} · 平均 {{average}}", { requests: bucket.points.length, errors, rejected: warnings, cancelled: cancelledCount, average: average == null ? "—" : `${average} ms` })}</span></div></TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <div className="mt-2 grid grid-cols-3 text-xs text-muted-foreground sm:grid-cols-5">{timeTicks.map((tick, index) => <span key={tick} className={cn("text-center tabular-nums", index % 2 === 1 && "hidden sm:block", index === 0 && "text-left", index === timeTicks.length - 1 && "text-right")}>{index === timeTicks.length - 1 ? t("现在") : new Date(tick).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>)}</div>
      </CardContent>
    </Card>
  )
}
