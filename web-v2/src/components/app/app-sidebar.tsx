import { CircleGaugeIcon, Settings2Icon, UsersRoundIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

export type AppPage = "accounts" | "settings"

const navigation = [
  {
    value: "accounts" as const,
    label: "账号路由",
    description: "身份与流量",
    icon: UsersRoundIcon,
  },
  {
    value: "settings" as const,
    label: "Gateway 设置",
    description: "边界与接管",
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
  const { isMobile, setOpenMobile } = useSidebar()

  const navigate = (nextPage: AppPage) => {
    onPageChange(nextPage)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center gap-3 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <CircleGaugeIcon aria-hidden="true" />
          </span>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Codex Router</p>
            <p className="truncate text-xs text-muted-foreground">
              Identity router
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>控制台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.value}>
                    <SidebarMenuButton
                      isActive={page === item.value}
                      tooltip={item.label}
                      aria-label={item.label}
                      size="lg"
                      onClick={() => navigate(item.value)}
                    >
                      <Icon aria-hidden="true" />
                      <span className="flex min-w-0 flex-col items-start leading-tight">
                        <span className="truncate font-medium">
                          {item.label}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
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
          <Badge variant="outline">安全</Badge>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
