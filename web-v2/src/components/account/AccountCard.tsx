import { Copy, KeyRound, MoreHorizontal, Power, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AccountStatusBadge } from "@/components/account/AccountStatusBadge"
import { AccountUsage } from "@/components/account/AccountUsage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import type { Account } from "@/services/contracts"

export type AccountAction = "toggle" | "refresh" | "refresh-auth" | "remove"

function AccountMenu({ account, busy, onAction }: { account: Account; busy: boolean; onAction(action: AccountAction): void }) {
  return <DropdownMenu><Tooltip><TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="账号操作" />} />}><MoreHorizontal /></TooltipTrigger><TooltipContent>账号操作</TooltipContent></Tooltip><DropdownMenuContent align="end"><DropdownMenuLabel className="font-mono">{shortAccountId(account.chatgptAccountId)}</DropdownMenuLabel><DropdownMenuItem disabled={busy || !account.enabled} onClick={() => onAction("refresh")}><RefreshCw />刷新用量</DropdownMenuItem><DropdownMenuItem disabled={busy || !account.enabled} onClick={() => onAction("refresh-auth")}><KeyRound />刷新认证</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => onAction("toggle")}><Power />{account.enabled ? "停用账号" : "启用账号"}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => onAction("remove")}><Trash2 />移除账号</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}

export function AccountIdentity({ account, active }: { account: Account; active: boolean }) {
  return <div className="min-w-0"><div className="flex min-w-0 items-center gap-1"><Tooltip><TooltipTrigger render={<span className="min-w-0 truncate font-mono text-sm font-medium" />}><span>{shortAccountId(account.chatgptAccountId)}</span></TooltipTrigger><TooltipContent className="font-mono">{account.chatgptAccountId}</TooltipContent></Tooltip><Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" className="shrink-0" aria-label="复制完整 Account ID" onClick={() => { void navigator.clipboard.writeText(account.chatgptAccountId); toast.success("Account ID 已复制") }} />}><Copy /></TooltipTrigger><TooltipContent>复制完整 Account ID</TooltipContent></Tooltip></div><div className="mt-1 flex min-w-0 items-center gap-2"><p className="min-w-0 truncate text-xs text-muted-foreground">{account.email ?? "Email unavailable"} · {account.planType ?? "Plan unavailable"}</p>{active && <Badge className="shrink-0">当前</Badge>}</div></div>
}

export function AccountCard({ account, active, busy, onAction }: { account: Account; active: boolean; busy: boolean; onAction(action: AccountAction): void }) {
  return <Card className={active ? "ring-2 ring-primary/45" : undefined}><CardHeader className="gap-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle><AccountIdentity account={account} active={active} /></CardTitle><CardDescription className="sr-only">账号详情</CardDescription></div><AccountMenu account={account} busy={busy} onAction={onAction} /></div><AccountStatusBadge status={account.authStatus} /></CardHeader><CardContent className="grid gap-3"><AccountUsage fallbackLabel="短周期额度" window={account.usage.primary} /><AccountUsage fallbackLabel="长周期额度" window={account.usage.secondary} /><p className="text-xs text-muted-foreground">用量更新：{formatRelativeTime(account.lastLimitsRefreshAt)}</p></CardContent></Card>
}

export { AccountMenu }
