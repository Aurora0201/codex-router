import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { AppHeader } from "@/components/app/AppHeader"
import { MockToolbar } from "@/components/app/MockToolbar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AccountsPage } from "@/pages/AccountsPage"
import { SettingsPage } from "@/pages/SettingsPage"
import type { Account, CodexStatus, GatewaySnapshot, MockScenario, SettingsState, ThemePreference } from "@/services/contracts"
import { mockGatewayService as gateway, mockScenarioController } from "@/services/mock/gateway-service"

type Page = "accounts" | "settings"
const scenarios: MockScenario[] = ["healthy", "empty", "no-active", "degraded", "offline"]

export default function App() {
  const urlScenario = new URLSearchParams(window.location.search).get("scenario") as MockScenario | null
  const [scenario, setScenario] = useState<MockScenario>(urlScenario && scenarios.includes(urlScenario) ? urlScenario : "healthy")
  const [page, setPage] = useState<Page>("accounts")
  const [data, setData] = useState<GatewaySnapshot | null>(null)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [codex, setCodex] = useState<CodexStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [theme, setTheme] = useState<ThemePreference>("system")

  const applyTheme = useCallback((next: ThemePreference) => { setTheme(next); const dark = next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches); document.documentElement.classList.toggle("dark", dark) }, [])
  const loadAll = useCallback(async () => { try { const [nextData, nextSettings, nextCodex] = await Promise.all([gateway.getSnapshot(), gateway.getSettings(), gateway.getCodexStatus()]); setData(nextData); setSettings(nextSettings); setCodex(nextCodex); applyTheme(nextSettings.theme); setError("") } catch (reason) { setError((reason as Error).message) } }, [applyTheme])
  useEffect(() => { mockScenarioController.setScenario(scenario); void loadAll() }, [loadAll, scenario])
  useEffect(() => { if (theme !== "system") return; const media = window.matchMedia("(prefers-color-scheme: dark)"); const change = () => applyTheme("system"); media.addEventListener("change", change); return () => media.removeEventListener("change", change) }, [applyTheme, theme])

  const run = async (key: string, operation: () => Promise<GatewaySnapshot>, message: string) => { setBusy(key); setError(""); try { setData(await operation()); toast.success(message) } catch (reason) { setError((reason as Error).message); toast.error((reason as Error).message) } finally { setBusy(null) } }
  const actions = { select: (id: string) => void run("select", () => gateway.setActiveAccount(id), "当前账号已切换"), clear: () => void run("select", () => gateway.clearActiveAccount(), "当前账号已清除"), toggle: (a: Account) => void run(a.id, () => gateway.setAccountEnabled(a.id, !a.enabled), a.enabled ? "账号已停用" : "账号已启用"), refresh: (a: Account) => void run(a.id, () => gateway.refreshUsage(a.id), "用量状态已刷新"), refreshAuth: (a: Account) => void run(a.id, () => gateway.refreshAuth(a.id), "认证已刷新"), remove: (a: Account) => void run(a.id, () => gateway.removeAccount(a.id), "账号已移除") }
  const dark = document.documentElement.classList.contains("dark")

  return <TooltipProvider delay={300}><Tabs value={page} onValueChange={(value) => setPage(value as Page)} className="h-dvh min-h-0 gap-0 overflow-hidden bg-background"><Toaster position="top-center" /><AppHeader online={data?.online} dark={dark} onToggleTheme={() => applyTheme(dark ? "light" : "dark")} tools={import.meta.env.DEV ? <MockToolbar scenario={scenario} onChange={setScenario} /> : undefined} /><main className="min-h-0 flex-1"><ScrollArea className="h-full overscroll-contain"><div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{!data || !settings || !codex ? <div className="grid gap-4"><Skeleton className="h-52 rounded-3xl" /><Skeleton className="h-64 rounded-3xl" /></div> : <><TabsContent value="accounts"><AccountsPage data={data} service={gateway} busy={busy} error={error} onSelect={actions.select} onClear={actions.clear} onToggle={actions.toggle} onRefresh={actions.refresh} onRefreshAuth={actions.refreshAuth} onRemove={actions.remove} onReload={() => void gateway.getSnapshot().then(setData)} /></TabsContent><TabsContent value="settings"><SettingsPage settings={settings} codex={codex} service={gateway} onSettingsChange={setSettings} onCodexChange={setCodex} onThemePreview={applyTheme} /></TabsContent></>}</div></ScrollArea></main></Tabs></TooltipProvider>
}
