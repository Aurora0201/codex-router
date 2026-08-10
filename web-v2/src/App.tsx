import { useCallback, useEffect, useState } from "react"
import { TriangleAlertIcon } from "lucide-react"

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
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"
import { createHttpGatewayService } from "@/services/http/gateway-service"
import { toast } from "@/components/ui/toast"

const defaultGatewayService = createHttpGatewayService()

function LoadingPage() {
  return (
    <div className="flex flex-col gap-5" aria-label="正在载入 Gateway 数据">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-[30rem] w-full lg:h-[clamp(30rem,calc(100dvh-13rem),48rem)]" />
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
  const [logsErrorsOnly, setLogsErrorsOnly] = useState(false)
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
          title: "主题保存失败",
          description: (reason as Error).message,
          type: "error",
        })
      }
    },
    [reload, service, setTheme, snapshot?.settings.theme]
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
          window.clearTimeout(debounce)
          debounce = window.setTimeout(refresh, 100)
        },
        () => undefined
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

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar page={page} onPageChange={navigate} activeAccount={activeAccount} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <AppHeader
          page={page}
          online={!error}
          version={snapshot?.health.version}
          onThemeChange={changeTheme}
        />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {error ? (
              <Alert variant="destructive" className="mb-6">
                <TriangleAlertIcon />
                <AlertTitle>无法读取 Gateway</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <span>{error}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void reload()}
                  >
                    重试
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
                onShowLogs={() => { setLogsErrorsOnly(true); setPage("logs") }}
              />
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
