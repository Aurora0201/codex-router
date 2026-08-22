import { TicketCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { QuotaMeter } from "./account-usage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  formatDateOnly,
  formatRelativeTime,
  shortAccountId,
} from "@/lib/format"
import type {
  AccountView,
  RateLimitResetCreditView,
  UsageWindowView,
} from "@/services/contracts"

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm">{value}</dd>
    </div>
  )
}

/**
 * Everything the row deliberately leaves out: plan, auth diagnostics, every
 * rate-limit bucket rather than the default one, and the reset credits.
 */
export function AccountDetailSheet({
  account,
  onOpenChange,
  onUseCredit,
}: {
  account: AccountView | null
  onOpenChange(open: boolean): void
  onUseCredit(account: AccountView, credit: RateLimitResetCreditView): void
}) {
  const { t } = useTranslation()
  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="font-mono">
            {shortAccountId(account?.chatgptAccountId ?? null)}
          </SheetTitle>
          <SheetDescription>
            {account?.email ?? t("未记录邮箱")}
          </SheetDescription>
        </SheetHeader>
        {account ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 px-4 pb-6">
              <section className="grid grid-cols-2 gap-4 rounded-lg border p-3">
                <Fact
                  label={t("订阅等级")}
                  value={account.planType ?? t("未知")}
                />
                <Fact
                  label={t("认证模式")}
                  value={account.auth.mode ?? t("未知")}
                />
                <Fact
                  label={t("订阅到期")}
                  value={
                    formatDateOnly(account.subscription.expiresAt) +
                    (account.subscription.source === "legacy_estimate"
                      ? ` · ${t("待确认")}`
                      : "")
                  }
                />
                <Fact
                  label={t("最近成功认证")}
                  value={formatRelativeTime(account.auth.lastSuccessfulAt)}
                />
              </section>

              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-heading font-medium">
                    {t("全部额度窗口")}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t("读数 {{time}}", {
                      time: formatRelativeTime(account.limits.checkedAt),
                    })}
                  </span>
                </div>
                {account.limits.buckets.length ? (
                  account.limits.buckets.map((bucket) => (
                    <div
                      key={bucket.key}
                      className="space-y-2 rounded-lg border p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">
                          {bucket.limitName ?? bucket.key}
                        </p>
                        {bucket.spendControlReached ? (
                          <Badge variant="destructive">{t("额度已耗尽")}</Badge>
                        ) : null}
                      </div>
                      {[bucket.primary, bucket.secondary]
                        .filter((w): w is UsageWindowView => w !== null)
                        .sort(
                          (a, b) =>
                            (b.windowDurationMins ?? 0) -
                            (a.windowDurationMins ?? 0)
                        )
                        .map((window, index) => (
                          <QuotaMeter
                            key={`${window.windowDurationMins}-${index}`}
                            window={window}
                          />
                        ))}
                      {bucket.credits ? (
                        <p className="text-xs text-muted-foreground">
                          {bucket.credits.unlimited === true
                            ? t("Credits：无限")
                            : t("Credits 余额：{{balance}}", {
                                balance: bucket.credits.balance ?? "—",
                              })}
                        </p>
                      ) : null}
                      {bucket.individualLimit ? (
                        <div className="pt-1">
                          <div className="mb-1.5 flex justify-between text-xs">
                            <span className="text-muted-foreground">
                              {t("个人月度限制剩余")}
                            </span>
                            <span className="font-mono tabular-nums">
                              {t("{{value}}%", {
                                value: bucket.individualLimit.remainingPercent,
                              })}
                            </span>
                          </div>
                          <Progress
                            value={bucket.individualLimit.remainingPercent}
                            aria-label={t("个人月度限制剩余")}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("额度数据不可用，可在账号操作中刷新用量额度。")}
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="font-heading font-medium">{t("额度重置券")}</h3>
                {account.limits.resetCredits?.credits?.length ? (
                  [...account.limits.resetCredits.credits]
                    .sort(
                      (a, b) =>
                        (a.expiresAt ?? Number.MAX_SAFE_INTEGER) -
                        (b.expiresAt ?? Number.MAX_SAFE_INTEGER)
                    )
                    .map((credit) => (
                      <div key={credit.id} className="rounded-lg border p-3">
                        <div className="flex justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {credit.title ?? t("额度重置券")}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {credit.expiresAt
                                ? t("有效期至 {{date}}", {
                                    date: formatDateOnly(credit.expiresAt),
                                  })
                                : t("无到期时间")}
                            </p>
                          </div>
                          <Badge variant="outline">{credit.status}</Badge>
                        </div>
                        {credit.status === "available" ? (
                          <Button
                            className="mt-3 w-full"
                            variant="outline"
                            size="sm"
                            onClick={() => onUseCredit(account, credit)}
                          >
                            <TicketCheckIcon data-icon="inline-start" />
                            {t("使用重置券")}
                          </Button>
                        ) : null}
                      </div>
                    ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("当前没有重置券")}
                  </p>
                )}
              </section>
            </div>
          </ScrollArea>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
