import { ClockArrowUpIcon, MoonIcon, SunIcon, WifiOffIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { AppPage } from "@/components/app/navigation"
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
  usage: "用量分析",
  gateway: "运行状态",
  preferences: "偏好设置",
  logs: "请求日志",
}

function formatUptime(
  uptimeSeconds: number | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (uptimeSeconds == null || uptimeSeconds < 60) return t("运行不足 1 分钟")
  const days = Math.floor(uptimeSeconds / 86_400)
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600)
  if (days > 0) return t("运行 {{days}} 天 {{hours}} 小时", { days, hours })
  const minutes = Math.floor((uptimeSeconds % 3_600) / 60)
  return t("运行 {{hours}} 小时 {{minutes}} 分", { hours, minutes })
}

export function AppHeader({
  page,
  online,
  uptimeSeconds,
  onThemeChange,
}: {
  page: AppPage
  online: boolean
  uptimeSeconds?: number
  onThemeChange?(theme: "light" | "dark"): Promise<void>
}) {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useTranslation()
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-6">
      <SidebarTrigger className="md:hidden" />
      <Separator orientation="vertical" className="h-4 md:hidden" />
      <p className="min-w-0 truncate text-base leading-none font-semibold">
        {t(pageTitle[page])}
      </p>
      <div className="ml-auto flex items-center gap-2">
        <div
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium [&_svg]:size-4",
            online ? "text-muted-foreground" : "text-destructive"
          )}
          role="status"
        >
          {online ? (
            <ClockArrowUpIcon aria-hidden="true" />
          ) : (
            <WifiOffIcon aria-hidden="true" />
          )}
          <span className="tabular-nums">
            {online ? formatUptime(uptimeSeconds, t) : t("Codex Router 离线")}
          </span>
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
