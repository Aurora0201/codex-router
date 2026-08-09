import { useState } from "react"
import { Plus, UserRoundX } from "lucide-react"

import { AccountCard, type AccountAction } from "@/components/account/AccountCard"
import { AccountTable } from "@/components/account/AccountTable"
import { ActiveAccountSelect } from "@/components/account/ActiveAccountSelect"
import { OAuthDialog } from "@/components/account/OAuthDialog"
import { TransportTrace } from "@/components/gateway/TransportTrace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { shortAccountId } from "@/lib/format"
import type { Account, GatewayService, GatewaySnapshot } from "@/services/contracts"

interface AccountsPageProps {
  data: GatewaySnapshot
  service: GatewayService
  busy: string | null
  error: string
  onSelect(id: string): void
  onClear(): void
  onToggle(account: Account): void
  onRefresh(account: Account): void
  onRefreshAuth(account: Account): void
  onRemove(account: Account): void
  onReload(): void
}

export function AccountsPage({
  data,
  service,
  busy,
  error,
  onSelect,
  onClear,
  onToggle,
  onRefresh,
  onRefreshAuth,
  onRemove,
  onReload,
}: AccountsPageProps) {
  const [loginOpen, setLoginOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const activeAccount = data.accounts.find(
    (account) => account.id === data.activeAccountId,
  )

  const accountAction = (account: Account, action: AccountAction) => {
    if (action === "remove") setRemoveTarget(account)
    else if (action === "toggle") onToggle(account)
    else if (action === "refresh-auth") onRefreshAuth(account)
    else onRefresh(account)
  }

  return (
    <>
      <div className="space-y-6">
        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <TransportTrace account={activeAccount} online={data.online} />
          <div className="grid grid-cols-2 gap-3">
            {[
              ["今日请求", data.requestsToday],
              ["今日错误", data.errorsToday],
              ["活动请求", data.activeRequests],
              ["WebSocket", data.activeWebSockets],
            ].map(([label, value]) => (
              <Card key={String(label)}>
                <CardContent className="p-4">
                  <p className="font-mono text-2xl font-semibold">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium text-muted-foreground">账号路由</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">ChatGPT 账号</h2>
            </div>
            <Button onClick={() => setLoginOpen(true)} disabled={!data.online}>
              <Plus />添加账号
            </Button>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-36">
                <p className="text-sm font-medium">当前账号</p>
                <p className="text-xs text-muted-foreground">下一次请求立即生效</p>
              </div>
              <ActiveAccountSelect
                accounts={data.accounts}
                activeAccountId={data.activeAccountId}
                disabled={busy != null || !data.online}
                onSelect={onSelect}
              />
              {data.activeAccountId ? (
                <Button variant="ghost" onClick={onClear} disabled={busy != null}>
                  清除选择
                </Button>
              ) : (
                data.accounts.length > 0 && (
                  <Badge variant="destructive">未选择时请求将失败</Badge>
                )
              )}
            </CardContent>
          </Card>

          {data.accounts.length === 0 ? (
            <Card className="md:h-[30rem]">
              <Empty>
                <EmptyMedia variant="icon"><UserRoundX /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>尚未添加账号</EmptyTitle>
                  <EmptyDescription>
                    添加你本人有权使用的 ChatGPT/Codex 账号后，Gateway 才能处理请求。
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setLoginOpen(true)} disabled={!data.online}>
                    <Plus />添加账号
                  </Button>
                </EmptyContent>
              </Empty>
            </Card>
          ) : (
            <>
              <AccountTable
                accounts={data.accounts}
                activeAccountId={data.activeAccountId}
                busy={busy}
                onAction={accountAction}
              />
              <div className="grid gap-4 md:hidden">
                {data.accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    active={account.id === data.activeAccountId}
                    busy={busy === account.id}
                    onAction={(action) => accountAction(account, action)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <OAuthDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        service={service}
        onComplete={onReload}
      />
      <AlertDialog
        open={removeTarget != null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除这个账号？</AlertDialogTitle>
            <AlertDialogDescription>
              将从 Mock 中移除 {removeTarget && shortAccountId(removeTarget.chatgptAccountId)}；如果它是当前账号，下一次请求将失败。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeTarget) onRemove(removeTarget)
                setRemoveTarget(null)
              }}
            >
              移除账号
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
