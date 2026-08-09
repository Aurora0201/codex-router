import { useCallback, useEffect, useMemo, useState } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { AppSidebar, type AppPage } from "@/components/app/app-sidebar"
import { AppHeader } from "@/components/app/app-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { AccountsPage } from "@/pages/accounts-page"
import { SettingsPage } from "@/pages/settings-page"
import type { GatewaySnapshot, MockScenario } from "@/services/contracts"
import {
  createMockGatewayService,
  scenarioFromUrl,
} from "@/services/mock/gateway-service"

function LoadingPage() {
  return (
    <div className="flex flex-col gap-6" aria-label="正在载入 Mock 数据">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 lg:col-span-2" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-[28rem] w-full" />
    </div>
  )
}

export function App() {
  const initialScenario = useMemo(() => scenarioFromUrl(), [])
  const service = useMemo(
    () => createMockGatewayService(initialScenario),
    [initialScenario]
  )
  const [page, setPage] = useState<AppPage>("accounts")
  const [scenario, setScenario] = useState<MockScenario>(initialScenario)
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setSnapshot(await service.getSnapshot())
      setError(null)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }, [service])

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0)
    return () => window.clearTimeout(timer)
  }, [reload])

  const changeScenario = (next: MockScenario) => {
    service.setScenario(next)
    setScenario(next)
    const url = new URL(window.location.href)
    url.searchParams.set("scenario", next)
    window.history.replaceState(null, "", url)
    void reload()
  }

  return (
    <SidebarProvider className="h-dvh min-h-0 overflow-hidden">
      <AppSidebar page={page} onPageChange={setPage} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <AppHeader
          page={page}
          online={!error}
          version={snapshot?.health.version}
          scenario={scenario}
          onScenarioChange={changeScenario}
        />
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[88rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {error ? (
              <Alert variant="destructive" className="mb-6">
                <TriangleAlertIcon />
                <AlertTitle>无法读取 Gateway Mock</AlertTitle>
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
            ) : (
              <SettingsPage
                snapshot={snapshot}
                service={service}
                reload={reload}
              />
            )}
          </div>
        </ScrollArea>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
