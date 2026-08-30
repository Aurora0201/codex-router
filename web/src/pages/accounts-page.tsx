import { useCallback, useEffect, useRef, useState } from "react"
import {
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountList } from "@/components/account/account-list"
import { BillingDialog } from "@/components/account/billing-dialog"
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
import { Button } from "@/components/ui/button"
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

import type { AccountAction } from "@/components/account/account-actions"

export function AccountsPage({
  snapshot,
  service,
  reload,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
}) {
  const { t } = useTranslation()
  const entered = useRef(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [removing, setRemoving] = useState<AccountView | null>(null)
  const [editingSubscription, setEditingSubscription] =
    useState<AccountView | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const { accounts, activeAccountId } = snapshot.accounts
  const active =
    accounts.find((account) => account.id === activeAccountId) ?? null

  const refreshAll = useCallback(
    async (notify = false) => {
      setRefreshingAll(true)
      try {
        await service.refreshAllAccountStatus()
        if (notify)
          toast.add({
            title: t("账号状态刷新已开始"),
            description: t("页面会随着各账号检查完成逐步更新。"),
            type: "success",
          })
      } catch (error) {
        toast.add({
          title: t("刷新全部状态失败"),
          description: (error as Error).message,
          type: "error",
        })
      } finally {
        setRefreshingAll(false)
      }
    },
    [service, t]
  )

  useEffect(() => {
    if (entered.current) return
    entered.current = true
    if (accounts.some((account) => account.enabled)) {
      void service.refreshAllAccountStatus().catch(() => undefined)
    }
  }, [accounts, service])

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, success: string) => {
      setBusyId(id)
      try {
        await action()
        await reload()
        toast.add({ title: success, type: "success" })
      } catch (error) {
        toast.add({
          title: t("操作失败"),
          description: (error as Error).message,
          type: "error",
        })
      } finally {
        setBusyId(null)
      }
    },
    [reload, t]
  )

  const accountAction = (account: AccountView, action: AccountAction) => {
    if (action === "copy") {
      void navigator.clipboard.writeText(account.chatgptAccountId ?? "")
      toast.add({ title: t("Account ID 已复制"), type: "success" })
    } else if (action === "remove") setRemoving(account)
    else if (action === "limits")
      void run(
        account.id,
        () => service.refreshAccountLimits(account.id),
        t("用量额度已刷新")
      )
    else if (action === "auth")
      void run(
        account.id,
        () => service.refreshAccountAuth(account.id),
        t("认证状态已刷新")
      )
    else if (action === "subscription") setEditingSubscription(account)
    else if (action === "toggle")
      void run(
        account.id,
        () => service.updateAccount(account.id, { enabled: !account.enabled }),
        account.enabled ? t("账号已停用") : t("账号已启用")
      )
  }

  const clearRoute = () => {
    if (!active) return
    void run(active.id, () => service.clearActiveAccount(), t("路由已清除"))
  }

  const consumeReset = async (
    account: AccountView,
    input: { idempotencyKey: string; creditId?: string }
  ) => {
    setBusyId(account.id)
    try {
      const result = await service.consumeAccountResetCredit(account.id, input)
      await reload()
      const messages = {
        reset: t("额度已重置"),
        alreadyRedeemed: t("该重置券已经使用"),
        nothingToReset: t("当前没有可重置的额度"),
        noCredit: t("没有可用的重置券"),
      }
      toast.add({
        title: messages[result.outcome],
        type:
          result.outcome === "reset" || result.outcome === "alreadyRedeemed"
            ? "success"
            : "info",
      })
    } catch (error) {
      toast.add({
        title: t("重置额度失败"),
        description: (error as Error).message,
        type: "error",
      })
      throw error
    } finally {
      setBusyId(null)
    }
  }

  const activeUnavailable =
    active !== null && (!active.enabled || active.auth.status !== "ready")
  const activeExhausted =
    active?.limits.buckets.some(
      (bucket) =>
        bucket.spendControlReached ||
        [bucket.primary, bucket.secondary].some(
          (window) =>
            window?.usedPercent !== null &&
            window?.usedPercent !== undefined &&
            window.usedPercent >= 100
        )
    ) ?? false

  return (
    <section className="flex flex-col gap-4 lg:h-full lg:min-h-0">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("账号与路由")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "所有请求只会进入你手动选定的认证账号，不自动轮换，不绑定会话。"
            )}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            className="h-9 flex-1 rounded-xl sm:flex-none"
            variant="outline"
            disabled={refreshingAll || accounts.length === 0}
            onClick={() => void refreshAll(true)}
          >
            <RefreshCwIcon
              className={refreshingAll ? "animate-spin" : undefined}
              data-icon="inline-start"
            />
            {t("刷新全部状态")}
          </Button>
          <Button
            className="h-9 flex-1 rounded-xl sm:flex-none"
            onClick={() => setLoginOpen(true)}
          >
            <PlusIcon data-icon="inline-start" />
            {t("添加账号")}
          </Button>
        </div>
      </div>

      {activeUnavailable || activeExhausted ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {activeUnavailable
              ? t("当前路由账号不可用")
              : t("当前路由账号额度已耗尽")}
          </AlertTitle>
          <AlertDescription>
            {activeUnavailable
              ? t(
                  "{{account}} 当前为 {{status}} 状态，后续请求可能失败。请处理该账号状态，或手动选择其他可路由账号。",
                  {
                    account: shortAccountId(active?.chatgptAccountId ?? null),
                    status: active
                      ? authStatusLabel(active.auth.status)
                      : t("未知"),
                  }
                )
              : t("当前账号仍保持为手动路由目标，系统不会自动切换账号。")}
          </AlertDescription>
        </Alert>
      ) : null}

      {accounts.length ? (
        <AccountList
          accounts={accounts}
          busyId={busyId}
          onAction={accountAction}
          onClearRoute={clearRoute}
          onSelect={(account) =>
            void run(
              account.id,
              () => service.setActiveAccount(account.id),
              t("已切换到 {{account}}", {
                account: shortAccountId(account.chatgptAccountId),
              })
            )
          }
          onConsumeReset={consumeReset}
        />
      ) : (
        <Card>
          <CardContent className="flex min-h-80 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRoundIcon />
                </EmptyMedia>
                <EmptyTitle>{t("尚未添加账号")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "账号池为空时，请求会使用 Codex 当前登录账号透传；添加账号后可手动指定路由账号。"
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setLoginOpen(true)}>
                  <PlusIcon data-icon="inline-start" />
                  {t("添加账号")}
                </Button>
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      )}

      <OAuthDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        service={service}
        onComplete={reload}
      />
      {editingSubscription ? (
        <BillingDialog
          key={editingSubscription.id}
          account={editingSubscription}
          busy={busyId === editingSubscription.id}
          onOpenChange={(open) => !open && setEditingSubscription(null)}
          onSave={({ billingAnchorAt, billingCadence }) => {
            const account = editingSubscription
            void run(
              account.id,
              () =>
                service.updateAccount(account.id, { billingAnchorAt, billingCadence }),
              t("自动续订设置已更新")
            ).then(() => setEditingSubscription(null))
          }}
        />
      ) : null}

      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("移除这个账号？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("将移除 {{account}} 及其隔离登录数据。此操作不可撤销。", {
                account: shortAccountId(removing?.chatgptAccountId ?? null),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing)
                  void run(
                    removing.id,
                    () => service.removeAccount(removing.id),
                    t("账号已移除")
                  )
                setRemoving(null)
              }}
            >
              {t("移除账号")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
