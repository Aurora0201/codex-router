import {
  CircleGaugeIcon,
  PanelLeftIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  RouteIcon,
  ScrollTextIcon,
  UsersRoundIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
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
import type { AccountView } from "@/services/contracts"

export type AppPage = "accounts" | "gateway" | "logs" | "preferences"

const navigation = [
  {
    value: "accounts" as const,
    label: "账号路由",
    icon: UsersRoundIcon,
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
}: {
  page: AppPage
  onPageChange(page: AppPage): void
  activeAccount?: AccountView
}) {
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar()

  const navigate = (nextPage: AppPage) => {
    onPageChange(nextPage)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        {state === "collapsed" && !isMobile ? (
          <div className="flex h-12 items-center justify-center">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="default"
                    size="icon"
                    className="group/logo-toggle relative"
                    aria-label="展开导航栏"
                    onClick={toggleSidebar}
                  />
                }
              >
                <CircleGaugeIcon className="transition-opacity group-hover/logo-toggle:opacity-0 group-focus-visible/logo-toggle:opacity-0" />
                <PanelLeftIcon className="absolute opacity-0 transition-opacity group-hover/logo-toggle:opacity-100 group-focus-visible/logo-toggle:opacity-100" />
              </TooltipTrigger>
              <TooltipContent side="right">展开导航栏</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="flex h-12 items-center gap-3 px-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <CircleGaugeIcon aria-hidden="true" />
            </span>
            <p className="min-w-0 truncate text-sm font-semibold">
              Codex Router
            </p>
            <SidebarTrigger className="ml-auto size-8" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>控制台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navigation.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.value}>
                    <SidebarMenuButton
                      isActive={page === item.value}
                      tooltip={item.label}
                      aria-label={item.label}
                      onClick={() => navigate(item.value)}
                      aria-current={page === item.value ? "page" : undefined}
                    >
                      <Icon aria-hidden="true" />
                      <span className="truncate group-data-[collapsible=icon]:hidden">
                        {item.label}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 px-2 py-2 text-left group-data-[collapsible=icon]:justify-center"
                onClick={() => navigate("accounts")}
                aria-label={activeAccount ? `当前路由账号 ${activeAccount.email ?? activeAccount.chatgptAccountId ?? activeAccount.id}` : "尚未选择路由"}
              />
            }
          >
            <RouteIcon className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="block text-xs font-medium">当前路由账号</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {activeAccount?.email ?? activeAccount?.chatgptAccountId ?? activeAccount?.id ?? "尚未选择路由"}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {activeAccount?.email ?? activeAccount?.chatgptAccountId ?? activeAccount?.id ?? "尚未选择路由"}
          </TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  )
}
