import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Tabs,
  TabsList,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import {
  AvailabilityPanel,
  ConnectionSummaryPanel,
  RequestOutcomePanel,
  RuntimeEnvironmentPanel,
} from "@/components/gateway/gateway-panels"
import { TakeoverHero } from "@/components/gateway/takeover-hero"
import { WebSocketActivityCard } from "@/components/gateway/websocket-activity-card"
import { toast } from "@/components/ui/toast"
import { useSlowLoad } from "@/hooks/use-slow-load"
import { formatDuration } from "@/lib/format"
import { normalizeRequestHistogram } from "@/lib/request-histogram"
import { cn } from "@/lib/utils"
import type {
  GatewayService,
  GatewaySnapshot,
  RequestLogRange,
  RequestLogsResponse,
} from "@/services/contracts"

const RANGES: Array<{ value: RequestLogRange; label: string; ms: number }> = [
  { value: "1h", label: "最近 1 小时", ms: 60 * 60_000 },
  { value: "24h", label: "最近 24 小时", ms: 24 * 60 * 60_000 },
  { value: "7d", label: "最近 7 天", ms: 7 * 24 * 60 * 60_000 },
]

const EMPTY: {
  timeline: RequestLogsResponse["timeline"]
  histogram: RequestLogsResponse["histogram"]
  summary: RequestLogsResponse["summary"]
} = {
  timeline: [],
  histogram: [],
  summary: {
    requests: 0,
    errors: 0,
    rejected: 0,
    cancelled: 0,
    availabilityRequests: 0,
    availabilityErrors: 0,
    averageDurationMs: null,
  },
}

type AvailabilitySnapshot = typeof EMPTY & {
  range: RequestLogRange
  from: number
  to: number
}

function initialAvailabilitySnapshot(): AvailabilitySnapshot {
  const to = Date.now()
  const selected = RANGES[1]
  return {
    ...EMPTY,
    range: selected.value,
    from: to - selected.ms,
    to,
  }
}

export function SettingsPage({
  snapshot,
  service,
  reload,
  onShowAccounts,
  logsRevision = 0,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
  onShowAccounts(): void
  logsRevision?: number
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<RequestLogRange>("24h")
  const [now, setNow] = useState(() => Date.now())
  const [availability, setAvailability] = useState(initialAvailabilitySnapshot)
  const [loadedRange, setLoadedRange] = useState<RequestLogRange | null>(null)
  const enabled = snapshot.settings.requestMetadataLogging

  // One fetch feeds the hero, the outcome breakdown and the availability
  // strip: they are three readings of the same window, so they share a range
  // rather than each owning a control that can disagree with its neighbours.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const selected = RANGES.find((item) => item.value === range) ?? RANGES[1]
    const queryTo = Date.now()
    const queryFrom = queryTo - selected.ms
    void service
      .getRequestLogs({
        range,
        from: queryFrom,
        to: queryTo,
        page: 1,
        limit: 1,
      })
      .then((result) => {
        if (cancelled) return
        setAvailability({
          range,
          from: queryFrom,
          to: queryTo,
          timeline: result.timeline,
          histogram: normalizeRequestHistogram(
            range,
            queryFrom,
            queryTo,
            result.histogram
          ),
          summary: result.summary,
        })
      })
      .catch((error) => {
        if (!cancelled)
          toast.add({
            title: t("请求日志载入失败"),
            description: (error as Error).message,
            type: "error",
          })
      })
      .finally(() => {
        if (!cancelled) setLoadedRange(range)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, range, logsRevision, service, t])

  useEffect(() => {
    const update = () => {
      if (!document.hidden) setNow(Date.now())
    }
    const timer = window.setInterval(update, 30_000)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  // Derived rather than stored: writing EMPTY back into state from the effect
  // is a synchronous setState that cascades a second render for nothing.
  const shown = enabled ? availability : { ...availability, ...EMPTY }
  // Derived, so the dim answers the question "is the window on screen the one
  // that was asked for" — and stays out of the way of the background refreshes
  // that arrive with live traffic, which keep the same range. Held back until
  // the load is slow enough to need explaining.
  const busy = useSlowLoad(
    enabled && loadedRange !== null && loadedRange !== range
  )
  // Only the three panels that read the window dim while it reloads. The
  // connection list and the environment strip come from the snapshot and have
  // nothing to do with the range; fading them made them look like they had
  // lost their data.
  const stale = cn(
    "transition-opacity duration-200 motion-reduce:transition-none",
    busy && "opacity-60"
  )
  const displayedRange =
    RANGES.find((item) => item.value === availability.range) ?? RANGES[1]

  const rangeTabs = (
    <Tabs
      value={range}
      onValueChange={(value) => {
        const next = RANGES.find((item) => item.value === value)
        if (!next || next.value === range) return
        // The previous window's numbers stay up while the next ones load.
        // Blanking them first collapsed the page by 50px and bounced
        // everything below the hero; the panels dim instead, which says
        // "updating" without moving anything.
        setRange(next.value)
      }}
      className="gap-0"
    >
      <TabsList aria-label={t("时间范围")}>
        {RANGES.map((item) => (
          <TabsTab className="text-xs" key={item.value} value={item.value}>
            {t(item.label)}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  )

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("运行状态")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("确认当前接管模式、请求表现和关键连接配置。")}
          </p>
        </div>
        {rangeTabs}
      </header>

      <div className="grid grid-cols-12 gap-4">
        <TakeoverHero
          reloading={busy}
          className={cn("col-span-12 xl:col-span-8", stale)}
          status={snapshot.codex}
          accounts={snapshot.accounts.accounts}
          service={service}
          reload={reload}
          onShowAccounts={onShowAccounts}
          summary={shown.summary}
          histogram={shown.histogram}
          from={shown.from}
          rangeLabel={t(displayedRange.label)}
          uptimeLabel={formatDuration(snapshot.stats.uptimeSeconds)}
        />

        <RequestOutcomePanel
          busy={busy}
          className={cn("col-span-12 self-start xl:col-span-4", stale)}
          summary={shown.summary}
          enabled={enabled}
        />

        {/* Ninety-six cells need the full width, and nothing else on the page
            wants to sit beside a strip this long. */}
        <AvailabilityPanel
          busy={busy}
          className={cn("col-span-12", stale)}
          histogram={shown.histogram}
          summary={shown.summary}
          enabled={enabled}
        />

        <WebSocketActivityCard
          className="col-span-12 xl:col-span-8"
          connections={snapshot.websocketConnections}
        />

        <ConnectionSummaryPanel
          className="col-span-12 xl:col-span-4"
          connections={snapshot.websocketConnections}
          now={now}
        />

        <RuntimeEnvironmentPanel
          className="col-span-12"
          snapshot={snapshot}
          status={snapshot.codex}
        />
      </div>
    </div>
  )
}
