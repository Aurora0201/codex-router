import { useMemo, useState } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  Clock3Icon,
  SearchXIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
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
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"
import { AccountActions } from "./account-actions"
import { AccountStatus } from "./account-status-badge"
import { AccountUsage } from "./account-usage"

type AccountAction =
  "copy" | "limits" | "auth" | "subscription" | "toggle" | "remove"
type AccountFilter = "all" | "routable" | "attention" | "disabled"

function isDisabled(account: AccountView) {
  return !account.enabled || account.authStatus === "disabled"
}

function isRoutable(account: AccountView) {
  return account.enabled && account.authStatus === "ready"
}

export function AccountList({
  accounts,
  busyId,
  onAction,
  onSelect,
}: {
  accounts: AccountView[]
  busyId: string | null
  onSelect(account: AccountView): void
  onAction(account: AccountView, action: AccountAction): void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<AccountFilter>("all")
  const activeAccountId = accounts.find((account) => account.isActive)?.id ?? ""
  const counts = useMemo(
    () => ({
      routable: accounts.filter(isRoutable).length,
      attention: accounts.filter(
        (account) => !isDisabled(account) && !isRoutable(account)
      ).length,
      disabled: accounts.filter(isDisabled).length,
    }),
    [accounts]
  )
  const filterItems = useMemo(
    () => [
      {
        value: "all" as const,
        label: t("全部（{{count}}）", { count: accounts.length }),
      },
      {
        value: "routable" as const,
        label: t("可路由（{{count}}）", { count: counts.routable }),
      },
      {
        value: "attention" as const,
        label: t("需处理（{{count}}）", { count: counts.attention }),
      },
      {
        value: "disabled" as const,
        label: t("已停用（{{count}}）", { count: counts.disabled }),
      },
    ],
    [accounts.length, counts, t]
  )
  const normalizedQuery = query.trim().toLowerCase()
  const filteredAccounts = useMemo(
    () =>
      accounts.filter((account) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          account.chatgptAccountId?.toLowerCase().includes(normalizedQuery) ||
          account.email?.toLowerCase().includes(normalizedQuery)
        const matchesFilter =
          filter === "all" ||
          (filter === "routable" && isRoutable(account)) ||
          (filter === "attention" &&
            !isDisabled(account) &&
            !isRoutable(account)) ||
          (filter === "disabled" && isDisabled(account))

        return Boolean(matchesQuery && matchesFilter)
      }),
    [accounts, filter, normalizedQuery]
  )
  const clearFilters = () => {
    setQuery("")
    setFilter("all")
  }

  return (
    <Card className="h-[30rem] min-h-0 lg:h-full">
      <CardHeader className="shrink-0">
        <CardTitle>{t("授权账号")}</CardTitle>
        <CardDescription>
          {t("搜索授权身份，并手动选择后续请求使用的路由账号。")}
        </CardDescription>
        <CardAction>
          <Badge
            variant="outline"
            className={cn(activeAccountId ? "text-success" : "text-warning")}
          >
            {activeAccountId ? (
              <CircleCheckIcon data-icon="inline-start" />
            ) : (
              <CircleAlertIcon data-icon="inline-start" />
            )}
            {activeAccountId ? t("已选择路由") : t("未选择路由")}
          </Badge>
        </CardAction>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("搜索授权账号")}
            placeholder={t("搜索 Account ID 或邮箱")}
            className="sm:max-w-sm"
          />
          <Select
            items={filterItems}
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value)
            }}
          >
            <SelectTrigger
              aria-label={t("筛选账号状态")}
              className="w-full sm:w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              <SelectGroup>
                {filterItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="shrink-0 text-xs text-muted-foreground sm:ml-auto">
            {t("显示 {{shown}} / 共 {{total}}", {
              shown: filteredAccounts.length,
              total: accounts.length,
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea
          className={cn(
            "h-full overflow-hidden",
            "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-5 before:bg-linear-to-b before:from-card before:via-card/70 before:to-transparent before:opacity-0 before:transition-opacity before:content-['']",
            "data-[overflow-y-start]:before:opacity-100",
            "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-5 after:bg-linear-to-t after:from-card after:via-card/70 after:to-transparent after:opacity-0 after:transition-opacity after:content-['']",
            "data-[overflow-y-end]:after:opacity-100",
            "[&_[data-slot=scroll-area-scrollbar]]:z-20 [&_[data-slot=scroll-area-scrollbar]]:opacity-0 [&_[data-slot=scroll-area-scrollbar]]:transition-opacity",
            "[&_[data-slot=scroll-area-scrollbar][data-hovering]]:opacity-100 [&_[data-slot=scroll-area-scrollbar][data-scrolling]]:opacity-100",
            "focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100",
            "[&_[data-slot=scroll-area-viewport]]:overscroll-y-none"
          )}
        >
          {filteredAccounts.length ? (
            <RadioGroup
              value={activeAccountId}
              onValueChange={(accountId) => {
                const account = accounts.find((item) => item.id === accountId)
                if (account && !account.isActive) onSelect(account)
              }}
              className="gap-0"
              aria-label={t("当前路由账号")}
            >
              <ItemGroup className="gap-0 p-2">
                {filteredAccounts.map((account, index) => {
                  const canSelect =
                    account.enabled && account.authStatus === "ready"

                  return (
                    <div key={account.id} role="listitem">
                      {index > 0 ? <ItemSeparator /> : null}
                      <Item
                        variant={account.isActive ? "muted" : "default"}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 py-3 xl:grid-cols-[auto_minmax(13rem,1.2fr)_minmax(0,2fr)_auto] xl:gap-x-5"
                      >
                        <ItemMedia className="col-start-1 row-start-1 group-has-data-[slot=item-description]/item:translate-y-0 group-has-data-[slot=item-description]/item:self-center">
                          {busyId === account.id ? (
                            <Spinner aria-label={t("正在切换路由账号")} />
                          ) : (
                            <RadioGroupItem
                              value={account.id}
                              disabled={busyId !== null || !canSelect}
                              aria-label={t("将 {{account}} 设为当前路由", {
                                account: shortAccountId(
                                  account.chatgptAccountId
                                ),
                              })}
                            />
                          )}
                        </ItemMedia>

                        <ItemContent className="col-start-2 row-start-1 min-w-0">
                          <ItemTitle className="[display:flex] w-full min-w-0 flex-nowrap overflow-visible whitespace-nowrap [-webkit-line-clamp:unset]">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="min-w-0 truncate font-mono" />
                                }
                              >
                                {shortAccountId(account.chatgptAccountId)}
                              </TooltipTrigger>
                              <TooltipContent>
                                {account.chatgptAccountId ??
                                  "Account ID unavailable"}
                              </TooltipContent>
                            </Tooltip>
                            <span
                              data-slot="account-status"
                              className="inline-flex shrink-0 items-center self-center whitespace-nowrap"
                            >
                              <AccountStatus account={account} />
                              {account.subscriptionExpiresAt !== null ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  {t("到期 {{date}}", {
                                    date: new Intl.DateTimeFormat(undefined, {
                                      year: "numeric",
                                      month: "2-digit",
                                      day: "2-digit",
                                      timeZone: "UTC",
                                    }).format(account.subscriptionExpiresAt),
                                  })}
                                </span>
                              ) : null}
                            </span>
                          </ItemTitle>
                          <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="min-w-0 truncate" />}
                              >
                                {account.email ?? t("无邮箱")}
                              </TooltipTrigger>
                              <TooltipContent>
                                {account.email ?? t("无邮箱")}
                              </TooltipContent>
                            </Tooltip>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">
                              {account.planType ?? t("未知套餐")}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex shrink-0 items-center gap-1 [&_svg]:size-3">
                              <Clock3Icon aria-hidden="true" />
                              {formatRelativeTime(account.lastLimitsRefreshAt)}
                            </span>
                          </ItemDescription>
                        </ItemContent>

                        <AccountUsage
                          usage={account.usage}
                          className="col-start-2 col-end-3 row-start-2 xl:col-start-3 xl:col-end-4 xl:row-start-1"
                        />

                        <ItemActions className="col-start-3 row-start-1 row-end-3 justify-end self-center xl:col-start-4 xl:row-end-2">
                          <AccountActions
                            account={account}
                            disabled={busyId === account.id}
                            onAction={(action) => onAction(account, action)}
                          />
                        </ItemActions>
                      </Item>
                    </div>
                  )
                })}
              </ItemGroup>
            </RadioGroup>
          ) : (
            <div className="flex min-h-full items-center justify-center p-6">
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SearchXIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t("没有匹配的账号")}</EmptyTitle>
                  <EmptyDescription>
                    {t("调整搜索内容或状态筛选后再试。")}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    {t("清除筛选")}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
