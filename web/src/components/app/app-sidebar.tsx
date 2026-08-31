import {
  ChevronRightIcon,
  PanelLeftIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  RouteIcon,
  ScrollTextIcon,
  ChartNoAxesCombinedIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/app/brand-mark"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  QUOTA_CRITICAL_PERCENT,
  QUOTA_TIGHT_PERCENT,
  SLOT_WINDOW_MINS,
  accountWindowSlots,
  remainingPercent,
  tightestRemaining,
} from "@/lib/account-state"
import { formatCountdown, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

/** Same thresholds and tones the account cards use, in a one-line form. */
function quotaTone(remaining: number, kind: "bg" | "text"): string {
  if (remaining <= QUOTA_CRITICAL_PERCENT)
    return kind === "bg" ? "bg-destructive" : "text-destructive"
  if (remaining <= QUOTA_TIGHT_PERCENT)
    return kind === "bg" ? "bg-warning" : "text-warning"
  return kind === "bg" ? "bg-primary" : "text-muted-foreground"
}

export type AppPage = "accounts" | "usage" | "gateway" | "logs" | "preferences"

const navigation = [
  {
    value: "accounts" as const,
    label: "账号路由",
    icon: UsersRoundIcon,
  },
  {
    value: "usage" as const,
    label: "用量分析",
    icon: ChartNoAxesCombinedIcon,
  },
  {
    value: "gateway" as const,
    label: "运行状态",
    icon: Settings2Icon,
  },
  {
    value: "logs" as const,
    label: "请求日志",
    icon: ScrollTextIcon,
  },
  {
    value: "preferences" as const,
    label: "偏好设置",
    icon: SlidersHorizontalIcon,
  },
]

export function AppSidebar({
  page,
  onPageChange,
  activeAccount,
  badges,
}: {
  page: AppPage
  onPageChange(page: AppPage): void
  activeAccount?: AccountView
  /** A count only where something is actually waiting on that page. */
  badges?: Partial<Record<AppPage, number>>
}) {
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  const navigate = (nextPage: AppPage) => {
    onPageChange(nextPage)
    if (isMobile) setOpenMobile(false)
  }

  // Upstream reports the plan as a lowercase enum; it is a proper noun on
  // screen.
  const plan = activeAccount?.planType
    ? activeAccount.planType.charAt(0).toUpperCase() +
      activeAccount.planType.slice(1)
    : null
  const identity =
    activeAccount?.email ??
    activeAccount?.chatgptAccountId ??
    activeAccount?.id ??
    t("尚未选择路由")
  // The short window bites first, so it reads first — the reverse of the
  // account cards, where the long window anchors the row.
  const [longWindow, shortWindow] = activeAccount
    ? accountWindowSlots(activeAccount)
    : [null, null]
  const slots = [shortWindow, longWindow] as const
  const tightest = activeAccount ? tightestRemaining(activeAccount) : null
  const tightestTone =
    tightest === null ? undefined : quotaTone(tightest, "text")
  // The collapsed rail has room for one icon, so the tooltip carries the same
  // reading in words.
  const footerLabel = activeAccount
    ? t("{{account}} · 剩余 {{remaining}}", {
        account: identity,
        remaining:
          tightest === null
            ? t("未报告")
            : t("{{value}}%", { value: Math.round(tightest) }),
      })
    : t("尚未选择路由")

  return (
    // The seam is a rule, not a gutter. The inset variant floated the content
    // on its own rounded, ringed surface, which put a second outline language
    // around every card that already draws one.
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-0">
        {state === "collapsed" && !isMobile ? (
          <div className="flex h-14 items-center justify-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="group/logo-toggle relative"
                    aria-label={t("展开导航栏")}
                    onClick={toggleSidebar}
                  />
                }
              >
                <BrandMark className="size-5 text-sidebar-foreground transition-opacity group-hover/logo-toggle:opacity-0 group-focus-visible/logo-toggle:opacity-0" />
                <PanelLeftIcon className="absolute opacity-0 transition-opacity group-hover/logo-toggle:opacity-100 group-focus-visible/logo-toggle:opacity-100" />
              </TooltipTrigger>
              <TooltipContent side="right">{t("展开导航栏")}</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="flex h-14 items-center gap-3 px-3">
            <BrandMark className="size-6 text-sidebar-foreground" />
            <p className="min-w-0 truncate font-logo text-lg leading-none font-semibold">
              Codex Router
            </p>
            <SidebarTrigger className="ml-auto size-8" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {/* No group label: five items in one group, and "控制台" named nothing
            the header above it had not already said. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => {
                const Icon = item.icon
                const count = badges?.[item.value]
                return (
                  <SidebarMenuItem key={item.value}>
                    <SidebarMenuButton
                      isActive={page === item.value}
                      tooltip={t(item.label)}
                      aria-label={t(item.label)}
                      onClick={() => navigate(item.value)}
                      aria-current={page === item.value ? "page" : undefined}
                    >
                      <Icon aria-hidden="true" />
                      <span className="truncate group-data-[collapsible=icon]:hidden">
                        {t(item.label)}
                      </span>
                    </SidebarMenuButton>
                    {count ? (
                      <SidebarMenuBadge>{count}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {/* What the routed account has left, not which one it is: the name is
            on the accounts page, but the headroom decides whether the next
            request goes through. The plan sits in the heading because it is
            what the bars are measured against. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto w-full flex-col items-stretch gap-2 px-2 py-2 text-left group-data-[collapsible=icon]:flex-row group-data-[collapsible=icon]:justify-center"
                onClick={() => navigate("accounts")}
                aria-label={footerLabel}
              />
            }
          >
            <span className="flex items-center gap-1.5">
              <RouteIcon
                className={cn("size-4 shrink-0", tightestTone)}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                {identity}
                {plan ? (
                  <span className="text-muted-foreground/70">
                    {" · "}
                    {plan}
                  </span>
                ) : null}
              </span>
              <ChevronRightIcon
                className="size-3.5 shrink-0 text-muted-foreground/70 group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
            </span>

            {activeAccount ? (
              <span className="grid gap-2 group-data-[collapsible=icon]:hidden">
                {slots.map((window, index) => {
                  const remaining = window ? remainingPercent(window) : null
                  return (
                    <span className="grid gap-1" key={SLOT_WINDOW_MINS[index]}>
                      <span className="flex items-baseline gap-2">
                        <span className="shrink-0 text-[11px] font-medium">
                          {formatUsageWindow(
                            window ?? {
                              usedPercent: null,
                              resetsAt: null,
                              windowDurationMins: SLOT_WINDOW_MINS[index],
                            }
                          )}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground/70">
                          {window?.resetsAt
                            ? t("{{time}}重置", {
                                time: formatCountdown(window.resetsAt),
                              })
                            : t("未报告")}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-[11px] font-medium tabular-nums",
                            remaining === null
                              ? "text-muted-foreground/70"
                              : quotaTone(remaining, "text")
                          )}
                        >
                          {remaining === null
                            ? "—"
                            : t("{{value}}%", { value: Math.round(remaining) })}
                        </span>
                      </span>
                      {/* Full width on its own line: the bar is what you read
                          at a glance, so nothing shares its row. */}
                      <span className="block h-1 overflow-hidden rounded-full bg-foreground/15">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            remaining === null
                              ? "bg-transparent"
                              : quotaTone(remaining, "bg")
                          )}
                          style={{ width: `${remaining ?? 0}%` }}
                        />
                      </span>
                    </span>
                  )
                })}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="right">{footerLabel}</TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  )
}
