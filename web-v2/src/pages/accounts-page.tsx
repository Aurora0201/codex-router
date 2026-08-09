import { useCallback, useState } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  CircleCheckBigIcon,
  CircleGaugeIcon,
  SendIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react"

import { AccountCard } from "@/components/account/account-card"
import { AccountTable } from "@/components/account/account-table"
import { ActiveAccountSelect } from "@/components/account/active-account-select"
import { OAuthDialog } from "@/components/account/oauth-dialog"
import { TransportTrace } from "@/components/gateway/transport-trace"
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
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { shortAccountId } from "@/lib/format"
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

  const selectAccount = async (value: string | null) => {
    await run(
      value ?? "clear",
      () =>
        value ? service.setActiveAccount(value) : service.clearActiveAccount(),
      value ? "当前账号已切换" : "当前账号已清除"
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

  const metrics = [
    { label: "账号总数", value: accounts.length, icon: UsersRoundIcon },
    {
      label: "认证就绪",
      value: snapshot.stats.accountsReady,
      icon: CircleCheckBigIcon,
    },
    {
      label: "今日请求",
      value: snapshot.stats.requestsToday.toLocaleString("zh-CN"),
      icon: SendIcon,
    },
    {
      label: "今日错误",
      value: snapshot.stats.errorsToday,
      icon: TriangleAlertIcon,
    },
  ]

  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-2">
          <Badge variant="outline" className="w-fit">
            <ActivityIcon />
            Manual routing
          </Badge>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              账号与路由
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              所有请求只会进入你手动选定的认证账号，不自动轮换，不绑定会话。
            </p>
          </div>
        </div>
        <OAuthDialog service={service} onComplete={reload} />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <TransportTrace accountId={active?.chatgptAccountId ?? null} />
        <Card className="h-full">
          <CardHeader>
            <CardTitle>当前路由账号</CardTitle>
            <CardDescription>切换会在下一个请求立即生效。</CardDescription>
            <CardAction>
              <Badge variant={active ? "default" : "secondary"}>
                {active ? "已选择" : "未选择"}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ActiveAccountSelect
              accounts={accounts}
              activeId={activeAccountId}
              disabled={busyId !== null}
              onValueChange={(value) => void selectAccount(value)}
            />
            {active ? (
              <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/60 p-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-background text-muted-foreground">
                  <CircleGaugeIcon aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs font-medium">
                    {shortAccountId(active.chatgptAccountId)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {active.email ?? "无邮箱"} · {active.planType ?? "未知套餐"}
                  </p>
                </div>
              </div>
            ) : accounts.length > 0 ? (
              <Alert>
                <AlertTriangleIcon />
                <AlertTitle>数据面已阻断</AlertTitle>
                <AlertDescription>
                  选择一个认证就绪账号后才会放行请求。
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>运行概览</CardTitle>
          <CardDescription>Gateway 当前进程内的实时摘要。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <div
                key={metric.label}
                className="flex min-w-0 items-center gap-3"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="truncate font-mono text-xl font-semibold tracking-tight">
                    {metric.value}
                  </p>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {accounts.length ? (
        <>
          <AccountTable
            accounts={accounts}
            busyId={busyId}
            onAction={accountAction}
          />
          <div className="flex flex-col gap-3 md:hidden">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                busy={busyId === account.id}
                onAction={(action) => accountAction(account, action)}
              />
            ))}
          </div>
        </>
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
