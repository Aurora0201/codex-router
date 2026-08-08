import { useEffect, useState } from "react";
import { KeyRound, Plus, Power, RefreshCw, Star, Trash2 } from "lucide-react";
import { api, type Account, type Login } from "../lib/api";
import { Badge, Button, Card, Dialog, Empty } from "../components/ui";

function status(account: Account): { label: string; tone: "good" | "warn" | "bad" | "neutral" } {
  const labels: Record<string, string> = { ready: "Ready", refreshing: "Refreshing", rate_limited: "Rate limited", relogin_required: "Re-login", unsupported_fedramp: "FedRAMP unsupported", disabled: "Disabled", login_pending: "Login pending", error: "Error" };
  return { label: labels[account.authStatus] ?? account.authStatus, tone: account.authStatus === "ready" ? "good" : account.authStatus === "refreshing" || account.authStatus === "login_pending" ? "warn" : account.authStatus === "disabled" ? "neutral" : "bad" };
}

function percent(value: number | null) { return value == null ? "—" : `${Math.round(value)}% used`; }
function reset(value: number | null) { return value == null ? "—" : new Date(value * (value < 10_000_000_000 ? 1000 : 1)).toLocaleString(); }

export function AccountsPage({ accounts, reload }: { accounts: Account[]; reload(): Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!login || login.status !== "waiting") return;
    const timer = window.setInterval(() => void api.loginStatus(login.loginId).then((next) => {
      setLogin(next);
      if (next.status === "complete") void reload();
    }).catch((reason: Error) => setError(reason.message)), 1500);
    return () => window.clearInterval(timer);
  }, [login, reload]);

  const action = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await operation(); await reload(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };
  const start = async () => {
    setBusy("login"); setError("");
    try { const next = await api.startLogin(label); setLogin(next); window.open(next.authUrl, "_blank", "noopener,noreferrer"); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  return <section className="space-y-4">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Identity pool</p><h1 className="mt-1 text-2xl font-semibold">Accounts</h1><p className="mt-1 text-sm text-muted-foreground">每个账号使用隔离的 Codex 登录目录。</p></div><Button onClick={() => { setOpen(true); setLogin(null); setLabel(""); }}><Plus size={16} />添加账号</Button></div>
    {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
    {accounts.length === 0 ? <Empty title="尚未添加账号" detail="添加你本人有权使用的 ChatGPT/Codex 账号后，Gateway 才会接收数据面请求。" /> : <div className="grid gap-3">
      {accounts.map((account) => { const state = status(account); return <Card key={account.id} className="grid gap-4 lg:grid-cols-[1.3fr_.7fr_1fr_1fr_auto] lg:items-center">
        <div><div className="flex items-center gap-2"><span className="font-semibold">{account.label}</span>{account.isDefault ? <Badge tone="good">Default</Badge> : null}</div><p className="mt-1 truncate text-xs text-muted-foreground">{account.email ?? "Email unavailable"}</p></div>
        <div><p className="text-xs text-muted-foreground">Plan</p><p className="mt-1 font-mono text-sm">{account.planType ?? "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Primary</p><p className="mt-1 text-sm">{percent(account.primaryUsedPercent)}</p><p className="text-xs text-muted-foreground">{reset(account.primaryResetsAt)}</p></div>
        <div><p className="text-xs text-muted-foreground">Secondary</p><p className="mt-1 text-sm">{percent(account.secondaryUsedPercent)}</p><p className="text-xs text-muted-foreground">{reset(account.secondaryResetsAt)}</p></div>
        <div className="flex flex-wrap items-center justify-end gap-1"><Badge tone={state.tone}>{state.label}</Badge><Button title="刷新额度" aria-label={`刷新 ${account.label} 额度`} variant="ghost" disabled={busy !== null || !account.enabled} onClick={() => action(`limits-${account.id}`, () => api.refreshLimits(account.id))}><RefreshCw size={15} className={busy === `limits-${account.id}` ? "animate-spin" : ""} /></Button><Button title="刷新认证" aria-label={`刷新 ${account.label} 认证`} variant="ghost" disabled={busy !== null || !account.enabled} onClick={() => action(`auth-${account.id}`, () => api.refreshAuth(account.id))}><KeyRound size={15} /></Button><Button title={account.enabled ? "禁用" : "启用"} aria-label={`${account.enabled ? "禁用" : "启用"} ${account.label}`} variant="ghost" disabled={account.fedRamp} onClick={() => action(`toggle-${account.id}`, () => api.updateAccount(account.id, { enabled: !account.enabled }))}><Power size={15} /></Button>{!account.isDefault && account.enabled ? <Button title="设为默认" aria-label={`将 ${account.label} 设为默认`} variant="ghost" onClick={() => action(`default-${account.id}`, () => api.setDefault(account.id))}><Star size={15} /></Button> : null}<Button title="移除" aria-label={`移除 ${account.label}`} variant="ghost" onClick={() => { if (confirm(`移除账号“${account.label}”及其隔离登录数据？`)) void action(`remove-${account.id}`, () => api.removeAccount(account.id)); }}><Trash2 size={15} /></Button></div>
      </Card>; })}
    </div>}
    <Dialog open={open} title="添加 ChatGPT/Codex 账号" onClose={() => setOpen(false)}>
      {!login ? <div className="space-y-4"><label className="grid gap-2 text-sm font-medium">账号标签<input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：Personal" className="rounded-md border bg-background px-3 py-2" /></label><p className="text-sm text-muted-foreground">将启动官方 Codex Browser OAuth。Gateway 不读取浏览器 Cookie。</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>取消</Button><Button disabled={!label.trim() || busy === "login"} onClick={() => void start()}>{busy === "login" ? "启动中…" : "打开官方登录"}</Button></div></div> : <div className="space-y-4"><Badge tone={login.status === "complete" ? "good" : login.status === "waiting" ? "warn" : "bad"}>{login.status}</Badge><p className="text-sm text-muted-foreground">{login.status === "waiting" ? "请在 OpenAI 官方页面完成授权。" : login.status === "complete" ? "账号已加入 Gateway。" : login.error ?? "登录未完成。"}</p><div className="flex flex-wrap justify-end gap-2">{login.status === "waiting" ? <><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(login.authUrl)}>复制链接</Button><Button variant="secondary" onClick={() => window.open(login.authUrl, "_blank", "noopener,noreferrer")}>重新打开登录页</Button><Button variant="danger" onClick={() => void api.cancelLogin(login.loginId).then(() => { setLogin({ ...login, status: "cancelled" }); void reload(); })}>取消登录</Button></> : null}<Button onClick={() => setOpen(false)}>完成</Button></div></div>}
    </Dialog>
  </section>;
}
