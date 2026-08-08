import { Copy, KeyRound, MoreHorizontal, Power, RefreshCw, Trash2, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AccountStatusBadge } from "./AccountStatusBadge";
import { AccountUsage } from "./AccountUsage";
import type { Account } from "@/lib/api";
import { formatClock, shortId } from "@/lib/format";

export function AccountCard({ account, onSetActive, onRefreshLimits, onRefreshAuth, onToggle, onRemove }: {
  account: Account;
  onSetActive(): void;
  onRefreshLimits(): void;
  onRefreshAuth(): void;
  onToggle(): void;
  onRemove(): void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardContent className="grid gap-4 p-5 lg:grid-cols-[1.2fr_.8fr_1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm font-semibold">{shortId(account.chatgptAccountId, 10, 6)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="复制完整 Account ID"
                  onClick={() => { void navigator.clipboard.writeText(account.chatgptAccountId ?? ""); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? "已复制" : "复制完整 Account ID"}</TooltipContent>
            </Tooltip>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {account.email ?? "Email unavailable"}{account.planType ? ` · ${account.planType}` : ""}
          </p>
          {account.rateLimitReachedType ? (
            <p className="mt-1 text-xs text-muted-foreground">Rate limit state: {account.rateLimitReachedType}</p>
          ) : null}
        </div>

        <div className="grid gap-3">
          <AccountUsage title="Primary" window={account.usage.primary} loading={false} />
          <AccountUsage title="Secondary" window={account.usage.secondary} loading={false} />
        </div>

        <div className="flex flex-col items-start justify-between gap-2">
          <AccountStatusBadge account={account} />
          <p className="text-xs text-muted-foreground">
            Updated {account.lastLimitsRefreshAt ? formatClock(account.lastLimitsRefreshAt) : "—"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`刷新 ${shortId(account.chatgptAccountId)} 使用量`}
                disabled={!account.enabled}
                onClick={onRefreshLimits}
              >
                <RefreshCw className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新使用量</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{shortId(account.chatgptAccountId)}</DropdownMenuLabel>
              <DropdownMenuItem onClick={onRefreshAuth} disabled={!account.enabled}>
                <KeyRound className="size-4" /> 刷新认证
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                <Power className="size-4" /> {account.enabled ? "禁用" : "启用"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemove}>
                <Trash2 className="size-4" /> 移除账号
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" className="h-8" disabled={account.isActive} onClick={onSetActive}>
            <UserRoundCheck className="size-4" /> {account.isActive ? "当前账号" : "使用此账号"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
