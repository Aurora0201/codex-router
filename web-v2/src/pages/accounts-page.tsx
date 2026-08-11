import { useCallback, useState } from "react"
import {
  CircleAlertIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react"

import { AccountList } from "@/components/account/account-list"
import { OAuthDialog } from "@/components/account/oauth-dialog"
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
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { authStatusLabel, shortAccountId } from "@/lib/format"
import type {
  AccountView,
  GatewayService,
  GatewaySnapshot,
} from "@/services/contracts"

type AccountAction = "copy" | "limits" | "auth" | "toggle" | "remove"

export function AccountsPage({
  snapshot,
  service,
  reload,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<AccountView | null>(null)
  const { accounts, activeAccountId } = snapshot.accounts
  const active =
    accounts.find((account) => account.id === activeAccountId) ?? null

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, success: string) => {
      setBusyId(id)
      try {
        await action()
        await reload()
        toast.add({ title: success, type: "success" })
      } catch (error) {
        toast.add({
          title: "操作失败",
          description: (error as Error).message,
          type: "error",
        })
      } finally {
        setBusyId(null)
      }
    },
    [reload]
  )

  const selectAccount = async (account: AccountView) => {
    await run(
      account.id,
      () => service.setActiveAccount(account.id),
      "当前路由账号已切换"
    )
  }

  const accountAction = (account: AccountView, action: AccountAction) => {
    if (action === "copy") {
      void navigator.clipboard.writeText(account.chatgptAccountId ?? "")
      toast.add({ title: "Account ID 已复制", type: "success" })
    } else if (action === "remove") {
      setRemoving(account)
    } else if (action === "limits") {
      void run(
        account.id,
        () => service.refreshAccountLimits(account.id),
        "用量额度已刷新"
      )
    } else if (action === "auth") {
      void run(
        account.id,
        () => service.refreshAccountAuth(account.id),
        "认证状态已刷新"
      )
    } else {
      void run(
        account.id,
        () => service.updateAccount(account.id, { enabled: !account.enabled }),
        account.enabled ? "账号已停用" : "账号已启用"
      )
    }
  }

  const activeUnavailable =
    active !== null && (!active.enabled || active.authStatus !== "ready")

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">账号与路由</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            所有请求只会进入你手动选定的认证账号，不自动轮换，不绑定会话。
          </p>
        </div>
        <OAuthDialog service={service} onComplete={reload} />
      </div>

      {accounts.length > 0 && active === null ? (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>尚未选择路由账号</AlertTitle>
          <AlertDescription>
            后续请求暂时无法路由，请在账号池中选择一个认证就绪账号。
          </AlertDescription>
        </Alert>
      ) : null}

      {activeUnavailable ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>当前路由账号不可用</AlertTitle>
          <AlertDescription>
            {shortAccountId(active.chatgptAccountId)} 当前为
            {authStatusLabel(active.authStatus)}
            状态，后续请求可能失败。请处理该账号状态，或手动选择其他可路由账号。
          </AlertDescription>
        </Alert>
      ) : null}

      {accounts.length ? (
        <AccountList
          accounts={accounts}
          busyId={busyId}
          onAction={accountAction}
          onSelect={(account) => void selectAccount(account)}
        />
      ) : (
        <Card>
          <CardContent className="flex min-h-80 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRoundIcon />
                </EmptyMedia>
                <EmptyTitle>尚未添加账号</EmptyTitle>
                <EmptyDescription>
                  添加一个你有权使用的 ChatGPT/Codex
                  账号后，再手动指定路由账号。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <OAuthDialog service={service} onComplete={reload} />
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      )}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除这个账号？</AlertDialogTitle>
            <AlertDialogDescription>
              将移除 {shortAccountId(removing?.chatgptAccountId ?? null)}{" "}
              及其隔离登录数据。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing)
                  void run(
                    removing.id,
                    () => service.removeAccount(removing.id),
                    "账号已移除"
                  )
                setRemoving(null)
              }}
            >
              移除账号
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
