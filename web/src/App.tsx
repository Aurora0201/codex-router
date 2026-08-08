import { useCallback, useEffect, useState } from "react";
import { CircleGauge, Settings as SettingsIcon, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { api, type AccountsResponse, type Health, type Settings, type Stats } from "./lib/api";
import { Toaster } from "@/components/ui/sonner";
import { TransportTrace } from "./components/TransportTrace";
import { AccountsPage } from "./pages/AccountsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Page = "accounts" | "settings";
const nav = [{ id: "accounts", label: "Accounts", icon: UsersRound }, { id: "settings", label: "Settings", icon: SettingsIcon }] as const;

export function App() {
  const [page, setPage] = useState<Page>("accounts");
  const [health, setHealth] = useState<Health | null>(null);
  const [accounts, setAccounts] = useState<AccountsResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      const next = await api.settings();
      setSettings(next);
      document.documentElement.dataset.theme = next.theme === "system" ? "" : next.theme;
    } catch { /* settings polling 失败不应拖垮其他页面 */ }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    void api.health().then(setHealth).catch((reason: Error) => setError(reason.message));
    const timer = window.setInterval(() => void api.health().then(setHealth).catch(() => undefined), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void api.stats().then(setStats).catch(() => undefined);
    const timer = window.setInterval(() => void api.stats().then(setStats).catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (page !== "accounts") return;
    void api.accounts().then(setAccounts).catch((reason: Error) => setError(reason.message));
    const timer = window.setInterval(() => void api.accounts().then(setAccounts).catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [page]);

  const reloadAccounts = useCallback(async () => {
    try { setAccounts(await api.accounts()); setError(""); } catch (reason) { setError((reason as Error).message); }
  }, []);

  const activeAccount = accounts?.accounts.find((item) => item.id === accounts.activeAccountId);

  return (
    <div className="mx-auto min-h-screen max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
      <Toaster richColors position="top-center" />
      <header className="rounded-xl border bg-card px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><CircleGauge className="size-5" /></span>
            <div>
              <p className="font-semibold">Codex Gateway</p>
              <p className="font-mono text-[11px] text-muted-foreground">transparent identity router · v{health?.version ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className={`size-2 rounded-full ${health ? "bg-primary shadow-[0_0_12px_var(--primary)]" : "bg-destructive"}`} />
            <span>{health ? "Gateway online" : "Gateway unavailable"}</span>
          </div>
        </div>
        <div className="mt-4"><TransportTrace account={activeAccount?.chatgptAccountId} /></div>
        <nav aria-label="Main navigation" className="mt-4 flex gap-1 overflow-x-auto">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              className={`flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${page === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <item.icon className="size-3.5" />{item.label}
            </button>
          ))}
        </nav>
      </header>
      {stats ? (
        <div className="my-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
          {[["Ready", stats.accountsReady], ["Requests today", stats.requestsToday], ["Errors today", stats.errorsToday]].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-card px-3 py-2"><span>{label}</span><strong className="ml-2 font-mono text-foreground">{value}</strong></div>
          ))}
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive" className="my-4"><AlertTitle>无法读取 Gateway</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
      <main className="py-4">
        {page === "accounts" ? (
          <AccountsPage data={accounts} onChanged={() => void reloadAccounts()} />
        ) : settings ? (
          <SettingsPage settings={settings} reload={loadSettings} />
        ) : null}
      </main>
    </div>
  );
}
