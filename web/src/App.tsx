import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AppSidebar } from "@/components/app/app-sidebar"
import {
  NAV_CHORDS,
  NAV_CHORD_PREFIX,
  type AppPage,
} from "@/components/app/navigation"
import { needsAttention } from "@/lib/account-state"
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
          if (resources.includes("usage"))
            setUsageRevision((value) => value + 1)
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
  // Stable, so the chord listener below is not torn down on every render — a
  // resubscribe between "g" and its letter would silently drop the chord.
  const navigate = useCallback((nextPage: AppPage) => {
    if (nextPage === "logs") setLogsErrorsOnly(false)
    setPage(nextPage)
  }, [])
  // `g` then a letter. The hints printed in the nav have to be true, so the
  // binding lives beside the page switch rather than in the sidebar that draws
  // them, and both read the same table.
  useEffect(() => {
    let armed = false
    let timer = 0
    const disarm = () => {
      armed = false
      window.clearTimeout(timer)
    }
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        /^(input|textarea|select)$/i.test(target.tagName))
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return disarm()
      if (isTyping(event.target)) return disarm()
      const key = event.key.toLowerCase()
      if (!armed) {
        if (key !== NAV_CHORD_PREFIX) return
        armed = true
        window.clearTimeout(timer)
        // Long enough to be a chord, short enough that a stray "g" does not
        // hijack the next keystroke.
        timer = window.setTimeout(disarm, 1500)
        return
      }
      disarm()
      const next = NAV_CHORDS[key]
      if (!next) return
      event.preventDefault()
      navigate(next)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.clearTimeout(timer)
    }
  }, [navigate])

  const fixedLogsLayout = page === "logs" && Boolean(snapshot) && !error
  // The account list scrolls inside its own card, so the page itself must not.
  const accountsLayout = page === "accounts" && Boolean(snapshot) && !error

  return (
    <SidebarProvider
      className="h-dvh min-h-0 overflow-hidden"
      style={{ "--sidebar-width-icon": "3.5rem" } as CSSProperties}
    >
      <AppSidebar
        page={page}
        onPageChange={navigate}
        activeAccount={activeAccount}
        badges={{
          // Only where something is actually waiting: accounts that cannot be
          // routed until someone acts, and today's failed requests.
          accounts: snapshot?.accounts.accounts.filter(needsAttention).length,
          logs: snapshot?.stats.errorsToday,
        }}
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
            (fixedLogsLayout || accountsLayout) &&
              "lg:[&_[data-slot=scroll-area-viewport]]:overflow-hidden"
          )}
        >
          {/* Keyed on the page, so each arrival is a fresh mount and settles
              the last four pixels into place. No fade: the switch is instant
              because the data is already here, so starting from transparent
              only put a blank frame in front of it, which reads as a blink
              rather than as movement. */}
          <div
            key={page}
            data-slot="page-content"
            className={cn(
              "mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-4",
              "motion-safe:animate-in motion-safe:duration-300 motion-safe:ease-out motion-safe:slide-in-from-bottom-1",
              fixedLogsLayout && "lg:h-full",
              accountsLayout && "lg:h-full"
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
