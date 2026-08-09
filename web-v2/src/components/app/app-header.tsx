import { MoonIcon, SunIcon } from "lucide-react"

import type { AppPage } from "@/components/app/app-sidebar"
import { MockToolbar } from "@/components/app/mock-toolbar"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MockScenario } from "@/services/contracts"

const pageCopy: Record<AppPage, { title: string; description: string }> = {
  accounts: { title: "账号路由", description: "身份、认证与流量控制" },
  settings: { title: "Gateway 设置", description: "网络边界与 Codex 接管" },
}

export function AppHeader({
  page,
  online,
  version,
  scenario,
  onScenarioChange,
}: {
  page: AppPage
  online: boolean
  version?: string
  scenario: MockScenario
  onScenarioChange(value: MockScenario): void
}) {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{pageCopy[page].title}</p>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {pageCopy[page].description}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {import.meta.env.DEV ? (
          <div className="hidden lg:block">
            <MockToolbar value={scenario} onValueChange={onScenarioChange} />
          </div>
        ) : null}
        <Badge variant={online ? "outline" : "destructive"}>
          {online ? `在线 · v${version ?? "—"}` : "Gateway 离线"}
        </Badge>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              />
            }
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span className="sr-only">切换主题</span>
          </TooltipTrigger>
          <TooltipContent>切换浅色或深色主题</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
