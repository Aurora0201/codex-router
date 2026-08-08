import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api, type Account, type AccountsResponse, type Login } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveAccountSelect } from "@/components/account/ActiveAccountSelect";
import { AccountCard } from "@/components/account/AccountCard";
import { shortId } from "@/lib/format";

export function AccountsPage({ data, onChanged }: { data: AccountsResponse | null; onChanged(): void }) {
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState<Login | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Account | null>(null);

  useEffect(() => {
    if (!login || login.status !== "waiting") return;
    const timer = window.setInterval(() => void api.loginStatus(login.loginId).then((next) => {
      setLogin(next);
      if (next.status === "complete") {
        onChanged();
        toast.success("账号已添加，请选择当前账号");
      } else if (next.status === "failed") {
        toast.error(next.error ?? "登录失败");
      }
    }).catch((reason: Error) => setError(reason.message)), 1500);
    return () => window.clearInterval(timer);
  }, [login, onChanged]);

  const run = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await operation(); onChanged(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  const start = async () => {
    setBusy("login"); setError("");
    try {
      const next = await api.startLogin();
      setLogin(next);
      window.open(next.authUrl, "_blank", "noopener,noreferrer");
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(null); }
  };

  const accounts = data?.accounts ?? [];
  const activeId = data?.activeAccountId ?? null;

  const selectActive = async (id: string) => {
    await run(`active-${id}`, () => api.setActive(id));
    const account = accounts.find((item) => item.id === id);
    toast.success(`当前账号已切换到 ${shortId(account?.chatgptAccountId)}，仅影响新会话`);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Authorized accounts</p>
            <h1 className="mt-1 text-2xl font-semibold">Accounts</h1>
            <p className="mt-1 text-sm text-muted-foreground">已授权的 ChatGPT/Codex 账号，以官方 Account ID 标记。</p>
          </div>
          <Button onClick={() => { setOpen(true); setLogin(null); setError(""); }}>
            <Plus className="size-4" />添加账号
          </Button>
        </div>

        {error ? <Alert variant="destructive"><AlertTitle>操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium">当前账号</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <ActiveAccountSelect
              accounts={accounts}
              activeId={activeId}
              disabled={busy !== null}
              onSelect={(id) => void selectActive(id)}
            />
            <p className="text-xs text-muted-foreground">切换只影响新会话，已有会话保持原绑定。</p>
          </div>
          {activeId == null && accounts.length > 0 ? (
            <Alert className="mt-3">
              <AlertTitle>尚未选择当前账号</AlertTitle>
              <AlertDescription>请选择一个账号后再启动新的 Codex 会话。切换只影响新会话，已有会话保持原绑定。</AlertDescription>
            </Alert>
          ) : null}
        </div>

        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-semibold">尚未添加账号</p>
            <p className="mt-1 text-sm text-muted-foreground">添加你本人有权使用的 ChatGPT/Codex 账号后，Gateway 才会接收数据面请求。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onSetActive={() => void selectActive(account.id)}
                onRefreshLimits={() => void run(`limits-${account.id}`, () => api.refreshLimits(account.id)).then(() => toast.success("使用量已刷新"))}
                onRefreshAuth={() => void run(`auth-${account.id}`, () => api.refreshAuth(account.id)).then(() => toast.success("认证已刷新"))}
                onToggle={() => void run(`toggle-${account.id}`, () => api.updateAccount(account.id, { enabled: !account.enabled }))}
                onRemove={() => setRemoving(account)}
              />
            ))}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加 ChatGPT/Codex 账号</DialogTitle>
              <DialogDescription>
                {login && login.status !== "waiting" ? "登录结果" : "将启动 Codex 官方 Browser OAuth。Gateway 不读取浏览器 Cookie。授权完成后，将使用该账号的 Account ID 自动标记账号。"}
              </DialogDescription>
            </DialogHeader>
            {!login ? (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
                <Button disabled={busy === "login"} onClick={() => void start()}>{busy === "login" ? "启动中…" : "打开官方登录"}</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Badge variant={login.status === "complete" ? "default" : login.status === "waiting" ? "secondary" : "destructive"}>{login.status}</Badge>
                {login.status === "complete" ? (
                  <p className="text-sm text-muted-foreground">
                    账号已添加。Account ID: {login.createdAccountId ? shortId(login.createdAccountId) : "—"}。请回到页面手动选择当前账号。
                  </p>
                ) : login.status === "waiting" ? (
                  <p className="text-sm text-muted-foreground">正在等待授权，请在 OpenAI 官方页面完成授权。</p>
                ) : (
                  <p className="text-sm text-muted-foreground">{login.error ?? "登录未完成。"}</p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  {login.status === "waiting" ? (
                    <>
                      <Button variant="ghost" onClick={() => void navigator.clipboard.writeText(login.authUrl)}>复制链接</Button>
                      <Button variant="secondary" onClick={() => window.open(login.authUrl, "_blank", "noopener,noreferrer")}>重新打开登录页</Button>
                      <Button variant="destructive" onClick={() => void api.cancelLogin(login.loginId).then(() => { setLogin({ ...login, status: "cancelled" }); onChanged(); })}>取消登录</Button>
                    </>
                  ) : null}
                  <Button onClick={() => setOpen(false)}>完成</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={removing != null} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>移除账号？</AlertDialogTitle>
              <AlertDialogDescription>
                将移除账号 {removing ? shortId(removing.chatgptAccountId) : ""} 及其隔离登录数据。此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => { if (removing) void run(`remove-${removing.id}`, () => api.removeAccount(removing.id)).then(() => toast.success("账号已移除")); setRemoving(null); }}
              >
                移除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </TooltipProvider>
  );
}
