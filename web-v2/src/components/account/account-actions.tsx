import {
  CopyIcon,
  EllipsisIcon,
  RefreshCwIcon,
  RotateCcwKeyIcon,
  Trash2Icon,
} from "lucide-react"

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
  onAction(action: "copy" | "limits" | "auth" | "toggle" | "remove"): void
}) {
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
          <span className="sr-only">账号操作</span>
        </TooltipTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="w-44 whitespace-nowrap"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => onAction("copy")}>
              <CopyIcon />
              复制 Account ID
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("limits")}
            >
              <RefreshCwIcon />
              刷新用量额度
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("auth")}
            >
              <RotateCcwKeyIcon />
              刷新认证
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={disabled}
              onClick={() => onAction("toggle")}
            >
              {account.enabled ? "停用账号" : "启用账号"}
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
              移除账号
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent>更多账号操作</TooltipContent>
    </Tooltip>
  )
}
