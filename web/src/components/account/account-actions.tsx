import {
  CopyIcon,
  EllipsisIcon,
  RefreshCwIcon,
  RotateCcwKeyIcon,
  CalendarDaysIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AccountView } from "@/services/contracts"

export function AccountActions({
  account,
  disabled,
  onAction,
}: {
  account: AccountView
  disabled?: boolean
  onAction(
    action: "copy" | "limits" | "auth" | "subscription" | "toggle" | "remove"
  ): void
}) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon" />}
            />
          }
        >
          <EllipsisIcon aria-hidden="true" />
          <span className="sr-only">{t("账号操作")}</span>
        </TooltipTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="w-44 whitespace-nowrap"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onAction("copy")}>
              <CopyIcon />
              {t("复制 Account ID")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("limits")}
            >
              <RefreshCwIcon />
              {t("刷新用量额度")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("auth")}
            >
              <RotateCcwKeyIcon />
              {t("刷新认证")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("subscription")}
            >
              <CalendarDaysIcon />
              {t("设置订阅到期日")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("toggle")}
            >
              {account.enabled ? t("停用账号") : t("启用账号")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={disabled}
              onClick={() => onAction("remove")}
            >
              <Trash2Icon />
              {t("移除账号")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>{t("更多账号操作")}</TooltipContent>
    </Tooltip>
  )
}
