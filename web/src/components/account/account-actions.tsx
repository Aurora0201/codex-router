import {
  CircleDollarSignIcon,
  CopyIcon,
  EllipsisIcon,
  PanelRightOpenIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCcwKeyIcon,
  RouteOffIcon,
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

export type AccountAction =
  | "detail"
  | "clearRoute"
  | "copy"
  | "limits"
  | "auth"
  | "subscription"
  | "toggle"
  | "remove"

export function AccountActions({
  account,
  disabled,
  size = "icon-sm",
  onAction,
}: {
  account: AccountView
  disabled?: boolean
  size?: "icon" | "icon-sm"
  onAction(action: AccountAction): void
}) {
  const { t } = useTranslation()
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size={size} />}
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
            <DropdownMenuItem onClick={() => onAction("detail")}>
              <PanelRightOpenIcon />
              {t("查看账号详情")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction("copy")}>
              <CopyIcon />
              {t("复制 Account ID")}
            </DropdownMenuItem>
            {account.isActive ? (
              <DropdownMenuItem
                disabled={disabled}
                onClick={() => onAction("clearRoute")}
              >
                <RouteOffIcon />
                {t("清除路由")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
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
              <CircleDollarSignIcon />
              {t("设置自动续订周期")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("toggle")}
            >
              <PowerIcon />
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
