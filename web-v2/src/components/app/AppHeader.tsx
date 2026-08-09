import { CircleGauge, Moon, Settings, Sun, UsersRound } from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function AppHeader({ online, dark, tools, onToggleTheme }: { online?: boolean; dark: boolean; tools?: ReactNode; onToggleTheme(): void }) {
  return (
    <header className="z-40 shrink-0 border-b bg-card/95 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-6 sm:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground"><CircleGauge className="size-5" /></span>
          <div className="min-w-0"><p className="truncate font-semibold">Codex Gateway</p><p className="truncate text-xs text-muted-foreground">本地账号控制台</p></div>
        </div>
        <TabsList aria-label="主导航" className="order-3 h-9 w-full sm:order-none sm:ml-2 sm:w-fit">
          <TabsTrigger value="accounts" className="px-3"><UsersRound />账号</TabsTrigger>
          <TabsTrigger value="settings" className="px-3"><Settings />设置</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex items-center gap-2">
          {tools}
          <Badge variant="outline" className="hidden sm:flex"><span className={`mr-1.5 size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-destructive"}`} />{online ? "Gateway 在线" : "Gateway 离线"}</Badge>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={dark ? "切换到浅色主题" : "切换到深色主题"} onClick={onToggleTheme} />}>
              {dark ? <Sun /> : <Moon />}
            </TooltipTrigger>
            <TooltipContent>{dark ? "切换到浅色主题" : "切换到深色主题"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
