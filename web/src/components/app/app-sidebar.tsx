import { ChevronRightIcon, PanelLeftIcon, RouteIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/app/brand-mark"
import {
  NAV_CHORD_PREFIX,
  navigation,
  settingsItem,
  type AppPage,
  type NavItem,
} from "@/components/app/navigation"
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

function CollapsedQuotaRing({
  window,
}: {
  window: ReturnType<typeof accountWindowSlots>[number]
}) {
  const { t } = useTranslation()
  const remaining = window ? remainingPercent(window) : null
  const label = formatUsageWindow(window)
  const radius = 9
  const circumference = 2 * Math.PI * radius

  return (
    <span
      data-slot="collapsed-quota-ring"
      role={remaining === null ? undefined : "progressbar"}
      aria-label={t("{{label}}剩余", { label })}
      aria-valuemin={remaining === null ? undefined : 0}
      aria-valuemax={remaining === null ? undefined : 100}
      aria-valuenow={remaining === null ? undefined : Math.round(remaining)}
      className="hidden size-5 shrink-0 place-items-center group-data-[collapsible=icon]:grid"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 -rotate-90">
        <circle
          cx="12"
          cy="12"
          r={radius}
          className="fill-none stroke-foreground/15"
          strokeWidth="2.5"
        />
        {remaining === null ? null : (
          <circle
            cx="12"
            cy="12"
            r={radius}
            className={cn(
              "fill-none transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none",
              remaining <= QUOTA_CRITICAL_PERCENT
                ? "stroke-destructive"
                : remaining <= QUOTA_TIGHT_PERCENT
                  ? "stroke-warning"
                  : "stroke-primary"
            )}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - remaining / 100)}
          />
        )}
      </svg>
    </span>
  )
}

/**
 * The current page is marked, not filled. A solid pill was the loudest block of
 * colour in the window and fought the one dark panel every page is built
 * around; a rule down the left edge and a weight change say it quietly.
 *
 * The right slot holds one thing, and the more urgent wins it: a count when
 * something is waiting, otherwise the chord that gets you here.
 */
function NavRow({
  item,
  page,
  count,
  onNavigate,
}: {
  item: NavItem
  page: AppPage
  count?: number
  onNavigate(next: AppPage): void
}) {
  const { t } = useTranslation()
  const Icon = item.icon
  const current = page === item.value
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={current}
        tooltip={t(item.label)}
        aria-label={t(item.label)}
        onClick={() => onNavigate(item.value)}
        aria-current={current ? "page" : undefined}
        className={cn(
          // px-3 rather than the variant's p-2, so the icon and the chord are
          // not pressed against the edges of a 256px rail.
          "relative px-3",
          "data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
          "data-active:hover:bg-sidebar-accent data-active:hover:text-sidebar-accent-foreground",
          "data-active:before:absolute data-active:before:top-1.5 data-active:before:bottom-1.5 data-active:before:left-0 data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-sidebar-primary data-active:before:content-['']"
        )}
      >
        <Icon aria-hidden="true" />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {t(item.label)}
        </span>
        {count ? null : (
          <span
            aria-hidden="true"
            className="ml-auto text-xs tracking-wider text-sidebar-foreground/50 uppercase opacity-0 transition-opacity group-hover/menu-button:opacity-100 group-focus-visible/menu-button:opacity-100 group-data-[collapsible=icon]:hidden"
          >
            {NAV_CHORD_PREFIX} {item.chord}
          </span>
        )}
      </SidebarMenuButton>
      {count ? (
        // Lands on the same right edge as the chord it replaces.
        <SidebarMenuBadge className="right-3">{count}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  )
}

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
  const collapsedWindow = shortWindow ?? longWindow
  const collapsedRemaining = collapsedWindow
    ? remainingPercent(collapsedWindow)
    : null
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
  const collapsedFooterLabel = activeAccount
    ? `${t("{{label}}剩余", {
        label: formatUsageWindow(collapsedWindow),
      })} · ${
        collapsedRemaining === null
          ? t("未报告")
          : t("{{value}}%", { value: Math.round(collapsedRemaining) })
      }`
    : t("尚未选择路由")

  return (
    // The seam is a rule, not a gutter. The inset variant floated the content
    // on its own rounded, ringed surface, which put a second outline language
    // around every card that already draws one.
    <Sidebar collapsible="icon">
      {/* Both rules or neither: the footer carries one, so the header needs
          its match. The height lives here with the rule so the border is
          inside the same 56px the page header measures — hung on the row
          below, it sat a pixel lower and the two lines did not meet. */}
      <SidebarHeader className="h-14 border-b border-sidebar-border p-0">
        {state === "collapsed" && !isMobile ? (
          <div className="flex size-14 shrink-0 items-center justify-center">
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
          // The brand mark keeps the same 20px rail every nav icon below it
          // stands on; the collapse trigger is chrome, so it sits nearer the
          // edge than the content does.
          <div className="flex h-full items-center gap-3 pr-2.5 pl-5">
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
        <SidebarGroup className="group-data-[collapsible=icon]:px-3">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => (
                <NavRow
                  key={item.value}
                  item={item}
                  page={page}
                  count={badges?.[item.value]}
                  onNavigate={navigate}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarMenu className="px-2 pb-2 group-data-[collapsible=icon]:px-3">
        <NavRow
          item={settingsItem}
          page={page}
          count={badges?.[settingsItem.value]}
          onNavigate={navigate}
        />
      </SidebarMenu>
      {/* The header carries a rule, so the quota panel needs the matching one
          or it reads as the tail of the nav rather than its own block. */}
      <SidebarFooter className="border-t border-sidebar-border group-data-[collapsible=icon]:px-3">
        {/* What the routed account has left, not which one it is: the name is
            on the accounts page, but the headroom decides whether the next
            request goes through. The plan sits in the heading because it is
            what the bars are measured against. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto w-full flex-col items-stretch gap-2 px-3 py-2 text-left group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:flex-row group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0!"
                onClick={() => navigate("accounts")}
                aria-label={
                  state === "collapsed" ? collapsedFooterLabel : footerLabel
                }
              />
            }
          >
            <span className="flex items-center gap-1.5 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center">
              <RouteIcon
                className={cn(
                  "size-4 shrink-0 group-data-[collapsible=icon]:hidden",
                  tightestTone
                )}
                aria-hidden="true"
              />
              <CollapsedQuotaRing window={collapsedWindow} />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                {identity}
                {plan ? (
                  <span className="text-muted-foreground-subtle">
                    {" · "}
                    {plan}
                  </span>
                ) : null}
              </span>
              <ChevronRightIcon
                className="size-3.5 shrink-0 text-muted-foreground-subtle group-data-[collapsible=icon]:hidden"
                aria-hidden="true"
              />
            </span>

            {activeAccount ? (
              // The collapsible attribute flips the instant the toggle is
              // pressed while the rail takes 200ms to widen, so this block
              // used to arrive at full strength inside a rail that was still
              // narrow. It collapses its own height and fades over the same
              // 200ms instead, landing with the rail rather than ahead of it.
              // A transition rather than an enter animation: an animation with
              // fill-mode both can be interrupted mid-toggle and leave the
              // block stuck at opacity 0.
              <span className="grid gap-3 overflow-hidden transition-[height,width,opacity] duration-200 group-data-[collapsible=icon]:h-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0 motion-reduce:transition-none">
                {slots.map((window, index) => {
                  const remaining = window ? remainingPercent(window) : null
                  return (
                    <span className="grid gap-1" key={SLOT_WINDOW_MINS[index]}>
                      {/* Name and number on one line, bar on the next, the
                          countdown under it — the same three lines the account
                          cards use, because three columns in 200px of rail was
                          more than the width could hold. */}
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium">
                          {formatUsageWindow(
                            window ?? {
                              usedPercent: null,
                              resetsAt: null,
                              windowDurationMins: SLOT_WINDOW_MINS[index],
                            }
                          )}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 text-xs font-medium tabular-nums",
                            remaining === null
                              ? "text-muted-foreground-subtle"
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
                      <span className="truncate text-xs text-muted-foreground-subtle">
                        {window?.resetsAt
                          ? t("{{time}}重置", {
                              time: formatCountdown(window.resetsAt),
                            })
                          : t("未报告")}
                      </span>
                    </span>
                  )
                })}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="right">
            {state === "collapsed" ? collapsedFooterLabel : footerLabel}
          </TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  )
}

export type { AppPage }
