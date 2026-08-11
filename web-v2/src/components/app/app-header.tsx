import { CircleIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { AppPage } from "@/components/app/app-sidebar"
import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const pageTitle: Record<AppPage, string> = {
  accounts: "账号路由",
  gateway: "运行状态",
  preferences: "偏好设置",
  logs: "请求日志",
}

export function AppHeader({
  page,
  online,
  version,
  onThemeChange,
}: {
  page: AppPage
  online: boolean
  version?: string
  onThemeChange?(theme: "light" | "dark"): Promise<void>
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useTranslation()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
      <SidebarTrigger className="md:hidden" />
      <Separator orientation="vertical" className="h-4 md:hidden" />
      <p className="min-w-0 truncate text-base font-semibold leading-none">{t(pageTitle[page])}</p>
      <div className="ml-auto flex items-center gap-2">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium [&_svg]:size-2",
            online ? "text-muted-foreground" : "text-destructive"
          )}
          role="status"
        >
          <CircleIcon className="fill-current" aria-hidden="true" />
          <span>{online ? t("Codex Router 在线 · v{{version}}", { version: version ?? "—" }) : t("Codex Router 离线")}</span>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  const nextTheme = resolvedTheme === "dark" ? "light" : "dark"
                  if (onThemeChange) void onThemeChange(nextTheme)
                  else setTheme(nextTheme)
                }}
              />
            }
          >
            {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />}
            <span className="sr-only">{t("切换主题")}</span>
          </TooltipTrigger>
          <TooltipContent>{t("切换浅色或深色主题")}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
