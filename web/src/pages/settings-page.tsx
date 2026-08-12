import {
  ActivityIcon,
  Clock3Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { MetricIconMedia } from "@/components/app/metric-icon-media"
import { CodexTakeoverCard } from "@/components/codex/codex-takeover-card"
import { WebSocketActivityCard } from "@/components/gateway/websocket-activity-card"
import { RequestAvailabilityCard } from "@/components/request/request-availability-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { cn } from "@/lib/utils"
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"

export function SettingsPage({
  snapshot,
  service,
  reload,
  onShowAccounts,
  onShowLogs,
  logsRevision = 0,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
  onShowAccounts(): void
  onShowLogs(): void
  logsRevision?: number
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const errorRate = snapshot.stats.requestsToday ? snapshot.stats.errorsToday / snapshot.stats.requestsToday * 100 : 0
  const uptimeHours = Math.floor(snapshot.stats.uptimeSeconds / 3600)
  const uptimeMinutes = Math.floor(snapshot.stats.uptimeSeconds % 3600 / 60)

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("运行状态")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("确认当前接管模式、运行表现和关键连接配置。")}</p>
      </div>

      <CodexTakeoverCard
        status={snapshot.codex}
        accounts={snapshot.accounts.accounts}
        service={service}
        reload={reload}
        onShowAccounts={onShowAccounts}
      />

      <Card aria-label={t("今日运行")}>
        <CardHeader>
          <CardTitle>{t("今日运行")}</CardTitle>
          <CardDescription>{t("Gateway 当前进程与今日请求的关键指标。")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Item variant="muted" className="min-h-16 min-w-0" aria-label={t("今日请求指标")}>
              <MetricIconMedia><ActivityIcon /></MetricIconMedia>
              <ItemContent className="min-w-0"><ItemTitle>{t("今日请求")}</ItemTitle><ItemDescription className="tabular-nums">{snapshot.stats.requestsToday.toLocaleString(locale)}</ItemDescription></ItemContent>
            </Item>
            <Item render={<button type="button" onClick={onShowLogs} />} variant="muted" className="min-h-16 min-w-0 text-left hover:bg-muted/80" aria-label={t("请求错误指标")}>
              <MetricIconMedia className={cn(errorRate >= 1 && "text-destructive")}><TriangleAlertIcon /></MetricIconMedia>
              <ItemContent className="min-w-0"><ItemTitle>{t("错误率")}</ItemTitle><ItemDescription className={cn("tabular-nums", errorRate >= 1 && "text-destructive")}>{errorRate.toFixed(2)}%</ItemDescription></ItemContent>
            </Item>
            <Item render={<button type="button" onClick={onShowAccounts} />} variant="muted" className="min-h-16 min-w-0 text-left hover:bg-muted/80" aria-label={t("查看 {{count}} 个可路由账号", { count: snapshot.stats.accountsReady })}>
              <MetricIconMedia><UsersRoundIcon /></MetricIconMedia>
              <ItemContent className="min-w-0"><ItemTitle>{t("可路由账号")}</ItemTitle><ItemDescription className="tabular-nums">{snapshot.stats.accountsReady.toLocaleString(locale)}</ItemDescription></ItemContent>
            </Item>
            <Item variant="muted" className="min-h-16 min-w-0">
              <MetricIconMedia><Clock3Icon /></MetricIconMedia>
              <ItemContent className="min-w-0"><ItemTitle>{t("运行时长")}</ItemTitle><ItemDescription className="tabular-nums">{t("{{hours}} 小时 {{minutes}} 分", { hours: uptimeHours, minutes: uptimeMinutes })}</ItemDescription></ItemContent>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <WebSocketActivityCard connections={snapshot.websocketConnections} />

      <RequestAvailabilityCard
        service={service}
        enabled={snapshot.settings.requestMetadataLogging}
        revision={logsRevision}
      />

      <Alert>
        <ShieldCheckIcon />
        <AlertDescription>{t("Codex Router 只读取路由元数据，不记录 Prompt、工具参数、工具输出或响应正文。")}</AlertDescription>
      </Alert>
    </section>
  )
}
