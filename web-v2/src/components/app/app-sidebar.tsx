import {
  CircleGaugeIcon,
  PanelLeftIcon,
  Settings2Icon,
  ShieldCheckIcon,
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

export type AppPage = "accounts" | "settings"

const navigation = [
  {
    value: "accounts" as const,
    label: "账号路由",
    icon: UsersRoundIcon,
  },
  {
    value: "settings" as const,
    label: "Gateway 设置",
    icon: Settings2Icon,
  },
]

export function AppSidebar({
  page,
  onPageChange,
}: {
  page: AppPage
  onPageChange(page: AppPage): void
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
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-background px-2.5 py-2 group-data-[collapsible=icon]:hidden">
          <div className="min-w-0">
            <p className="text-xs font-medium">本地数据面</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              127.0.0.1:8317
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3.5">
            <ShieldCheckIcon aria-hidden="true" />
            安全
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
