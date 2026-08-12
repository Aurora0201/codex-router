import { useTranslation } from "react-i18next"

import { CodexTakeoverCard } from "@/components/codex/codex-takeover-card"
import { WebSocketActivityCard } from "@/components/gateway/websocket-activity-card"
import { RequestAvailabilityCard } from "@/components/request/request-availability-card"
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"

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

  return (
    <section className="flex flex-col gap-5 lg:h-full lg:min-h-[48rem]">
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

      <RequestAvailabilityCard
        service={service}
        enabled={snapshot.settings.requestMetadataLogging}
        revision={logsRevision}
      />

      <WebSocketActivityCard connections={snapshot.websocketConnections} />
    </section>
  )
}
