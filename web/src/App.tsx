import { useCallback, useEffect, useState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AppSidebar, type AppPage } from "@/components/app/app-sidebar"
import { AppHeader } from "@/components/app/app-header"
import { useTheme, type Theme } from "@/components/theme-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { AccountsPage } from "@/pages/accounts-page"
import { SettingsPage } from "@/pages/settings-page"
import { PreferencesPage } from "@/pages/preferences-page"
import { RequestLogsPage } from "@/pages/request-logs-page"
import { UsagePage } from "@/pages/usage-page"
import { cn } from "@/lib/utils"
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"
import { createHttpGatewayService } from "@/services/http/gateway-service"
import { toast } from "@/components/ui/toast"

const defaultGatewayService = createHttpGatewayService()

function LoadingPage() {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col gap-5 lg:h-full lg:min-h-0"
      aria-label={t("正在载入 Codex Router 数据")}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-[30rem] w-full lg:min-h-0 lg:flex-1" />
    </div>
  )
}

export function App({
  service = defaultGatewayService,
}: {
  service?: GatewayService
}) {
  const [page, setPage] = useState<AppPage>("accounts")
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logsRevision, setLogsRevision] = useState(0)
  const [usageRevision, setUsageRevision] = useState(0)
  const [logsErrorsOnly, setLogsErrorsOnly] = useState(false)
  const { t } = useTranslation()
  const { setTheme } = useTheme()
  const snapshotTheme = snapshot?.settings.theme

  const reload = useCallback(async () => {
    try {
      setSnapshot(await service.getSnapshot())
      setError(null)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }, [service])

  useEffect(() => {
    if (snapshotTheme) setTheme(snapshotTheme)
  }, [snapshotTheme, setTheme])

  const changeTheme = useCallback(
    async (nextTheme: Theme) => {
      const previous = snapshot?.settings.theme ?? "system"
      setTheme(nextTheme)
      try {
        await service.saveSettings({ theme: nextTheme })
        await reload()
      } catch (reason) {
        setTheme(previous)
        toast.add({
          title: t("主题保存失败"),
          description: (reason as Error).message,
          type: "error",
        })
      }
    },
    [reload, service, setTheme, snapshot?.settings.theme, t]
  )

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void reload()
    }
    let unsubscribe: () => void = () => undefined
    let debounce: number | undefined
    const connect = () => {
      unsubscribe()
      unsubscribe = service.subscribe(
        (resources) => {
          if (resources.includes("logs")) setLogsRevision((value) => value + 1)
          if (resources.includes("usage")) setUsageRevision((value) => value + 1)
          if (resources.length === 1 && resources[0] === "usage") return
          window.clearTimeout(debounce)
          debounce = window.setTimeout(refresh, 100)
        },
        () => undefined,
        (event) => {
          if (
            event.type === "request_started" ||
            event.type === "request_finished" ||
            event.type === "connection_updated"
          ) {
            setLogsRevision((value) => value + 1)
          }
        }
      )
    }
    const initial = window.setTimeout(() => {
      refresh()
      connect()
    }, 0)
    const timer = window.setInterval(refresh, 30_000)
    const handleVisibility = () => {
      if (document.hidden) {
        unsubscribe()
      } else {
        void reload()
        connect()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.clearTimeout(debounce)
      unsubscribe()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [reload, service])

  const activeAccount = snapshot?.accounts.accounts.find(
    (account) => account.id === snapshot.accounts.activeAccountId
  )
  const navigate = (nextPage: AppPage) => {
    if (nextPage === "logs") setLogsErrorsOnly(false)
    setPage(nextPage)
  }
  const fixedLogsLayout = page === "logs" && Boolean(snapshot) && !error
  const gatewayLayout = page === "gateway" && Boolean(snapshot) && !error

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar
        page={page}
        onPageChange={navigate}
        activeAccount={activeAccount}
      />
      <SidebarInset className="min-h-0 overflow-hidden">
        <AppHeader
          page={page}
          online={!error}
          uptimeSeconds={snapshot?.stats.uptimeSeconds}
          onThemeChange={changeTheme}
        />
        <ScrollArea
          className={cn(
            "min-h-0 flex-1",
            fixedLogsLayout &&
              "lg:[&_[data-slot=scroll-area-viewport]]:overflow-hidden"
          )}
        >
          <div
            className={cn(
              "mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-4",
              fixedLogsLayout && "lg:h-full",
              gatewayLayout && "lg:h-full"
            )}
          >
            {error ? (
              <Alert variant="destructive" className="mb-6">
                <TriangleAlertIcon />
                <AlertTitle>{t("无法连接 Codex Router")}</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reload()}
                  >
                    {t("重试")}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {!snapshot ? (
              <LoadingPage />
            ) : page === "accounts" ? (
              <AccountsPage
                snapshot={snapshot}
                service={service}
                reload={reload}
              />
            ) : page === "gateway" ? (
              <SettingsPage
                snapshot={snapshot}
                service={service}
                reload={reload}
                onShowAccounts={() => setPage("accounts")}
                logsRevision={logsRevision}
              />
            ) : page === "usage" ? (
              <UsagePage service={service} revision={usageRevision} />
            ) : page === "logs" ? (
              <RequestLogsPage
                service={service}
                accounts={snapshot.accounts.accounts}
                enabled={snapshot.settings.requestMetadataLogging}
                initialErrorsOnly={logsErrorsOnly}
                revision={logsRevision}
                onShowPreferences={() => setPage("preferences")}
              />
            ) : (
              <PreferencesPage
                snapshot={snapshot}
                service={service}
                reload={reload}
                onThemeChange={changeTheme}
              />
            )}
          </div>
        </ScrollArea>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
