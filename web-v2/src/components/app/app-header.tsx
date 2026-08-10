import { CircleIcon, MoonIcon, SunIcon } from "lucide-react"

import type { AppPage } from "@/components/app/app-sidebar"
import { MockToolbar } from "@/components/app/mock-toolbar"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MockScenario } from "@/services/contracts"
import { cn } from "@/lib/utils"

const pageTitle: Record<AppPage, string> = {
  accounts: "账号路由",
  settings: "Gateway 设置",
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
      <SidebarTrigger className="md:hidden" />
      <Separator orientation="vertical" className="h-4 md:hidden" />
      <p className="min-w-0 truncate text-sm font-medium">{pageTitle[page]}</p>
      <div className="ml-auto flex items-center gap-2">
        {import.meta.env.DEV ? (
          <div className="hidden lg:block">
            <MockToolbar value={scenario} onValueChange={onScenarioChange} />
          </div>
        ) : null}
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium [&_svg]:size-2",
            online ? "text-muted-foreground" : "text-destructive"
          )}
          role="status"
        >
          <CircleIcon className="fill-current" aria-hidden="true" />
          <span>{online ? `在线 · v${version ?? "—"}` : "Gateway 离线"}</span>
        </div>
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
