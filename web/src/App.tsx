import { useCallback, useEffect, useState } from "react";
import { Activity, CircleGauge, Settings as SettingsIcon, UsersRound } from "lucide-react";
import { api, type Account, type Health, type Session, type Settings, type Stats } from "./lib/api";
import { TransportTrace } from "./components/TransportTrace";
import { AccountsPage } from "./pages/AccountsPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";

type Page = "accounts" | "sessions" | "settings";
const nav = [{ id: "accounts", label: "Accounts", icon: UsersRound }, { id: "sessions", label: "Sessions", icon: Activity }, { id: "settings", label: "Settings", icon: SettingsIcon }] as const;

export function App() {
  const [page, setPage] = useState<Page>("accounts");
  const [health, setHealth] = useState<Health | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [nextHealth, nextAccounts, nextSessions, nextSettings, nextStats] = await Promise.all([api.health(), api.accounts(), api.sessions(), api.settings(), api.stats()]);
      setHealth(nextHealth); setAccounts(nextAccounts); setSessions(nextSessions); setSettings(nextSettings); setStats(nextStats); setError("");
      document.documentElement.dataset.theme = nextSettings.theme === "system" ? "" : nextSettings.theme;
    } catch (reason) { setError((reason as Error).message); }
  }, []);

  useEffect(() => { void reload(); const timer = window.setInterval(() => void reload(), 5000); return () => window.clearInterval(timer); }, [reload]);

  return <div className="mx-auto min-h-screen max-w-[1440px] px-4 py-4 sm:px-6 lg:px-8">
    <header className="rounded-xl border bg-card px-4 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><CircleGauge size={20} /></span><div><p className="font-semibold">Codex Gateway</p><p className="font-mono text-[11px] text-muted-foreground">transparent identity router · v{health?.version ?? "—"}</p></div></div><div className="flex items-center gap-2 text-sm"><span className={`size-2 rounded-full ${health ? "bg-primary shadow-[0_0_12px_var(--primary)]" : "bg-destructive"}`} /><span>{health ? "Gateway online" : "Gateway unavailable"}</span></div></div>
      <div className="mt-4"><TransportTrace account={accounts.find((item) => item.isDefault)?.label} /></div>
      <nav aria-label="Main navigation" className="mt-4 flex gap-1 overflow-x-auto">{nav.map((item) => <button key={item.id} onClick={() => setPage(item.id)} aria-current={page === item.id ? "page" : undefined} className={`flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${page === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon size={15} />{item.label}</button>)}</nav>
    </header>
    {stats ? <div className="my-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">{[["Ready", stats.accountsReady], ["Active sessions", stats.activeSessions], ["Active WS", stats.activeWebSockets], ["Requests today", stats.requestsToday], ["Errors today", stats.errorsToday]].map(([label, value]) => <div key={label} className="rounded-lg border bg-card px-3 py-2"><span>{label}</span><strong className="ml-2 font-mono text-foreground">{value}</strong></div>)}</div> : null}
    {error ? <div role="alert" className="my-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">无法读取 Gateway：{error}</div> : null}
    <main className="py-4">{page === "accounts" ? <AccountsPage accounts={accounts} reload={reload} /> : page === "sessions" ? <SessionsPage sessions={sessions} reload={reload} /> : settings ? <SettingsPage settings={settings} accounts={accounts} reload={reload} /> : null}</main>
  </div>;
}
