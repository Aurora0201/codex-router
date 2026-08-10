import {
  ActivityIcon,
  Clock3Icon,
  FileLock2Icon,
  LockKeyholeIcon,
  NetworkIcon,
  RouteIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react"

import { CodexTakeoverCard } from "@/components/codex/codex-takeover-card"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"

export function SettingsPage({
  snapshot,
  service,
  reload,
  onShowAccounts,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
  onShowAccounts(): void
}) {
  const errorRate = snapshot.stats.requestsToday
    ? (snapshot.stats.errorsToday / snapshot.stats.requestsToday) * 100
    : 0
  const uptimeHours = Math.floor(snapshot.stats.uptimeSeconds / 3600)
  const uptimeMinutes = Math.floor((snapshot.stats.uptimeSeconds % 3600) / 60)

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gateway</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理 Codex 接管、本地网络边界和运行诊断信息。
        </p>
      </div>

      <CodexTakeoverCard
        status={snapshot.codex}
        service={service}
        reload={reload}
      />

      <Card size="sm" aria-label="运行摘要">
        <CardHeader className="sr-only">
          <CardTitle>运行摘要</CardTitle>
          <CardDescription>Gateway 今日请求与账号可用情况。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ItemGroup className="grid grid-cols-2 gap-3">
            <Item variant="muted" className="min-w-0" aria-label="今日请求指标">
              <ItemMedia variant="icon">
                <ActivityIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemDescription>今日请求</ItemDescription>
                <ItemTitle className="text-2xl font-semibold tabular-nums">
                  {snapshot.stats.requestsToday.toLocaleString()}
                </ItemTitle>
              </ItemContent>
            </Item>
            <Item variant="muted" className="min-w-0" aria-label="请求错误指标">
              <ItemMedia variant="icon">
                <TriangleAlertIcon
                  className={cn(errorRate >= 1 && "text-destructive")}
                />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemDescription>请求错误</ItemDescription>
                <ItemTitle
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    errorRate >= 1 && "text-destructive"
                  )}
                >
                  {snapshot.stats.errorsToday.toLocaleString()}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className={cn(errorRate >= 1 && "text-destructive")}>
                  错误率{" "}
                  <span className="tabular-nums">{errorRate.toFixed(2)}%</span>
                </span>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Separator />
          <ItemGroup className="grid grid-cols-2 gap-3">
            <Item
              render={<button type="button" onClick={onShowAccounts} />}
              size="xs"
              className="min-w-0 text-left hover:bg-muted"
              aria-label={`查看 ${snapshot.stats.accountsReady} 个可路由账号`}
            >
              <ItemMedia variant="icon">
                <UsersRoundIcon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>可路由账号</ItemTitle>
                <ItemDescription>认证就绪并已启用</ItemDescription>
              </ItemContent>
              <ItemActions>
                <span className="text-sm font-medium tabular-nums">
                  {snapshot.stats.accountsReady}
                </span>
              </ItemActions>
            </Item>
            <Item size="xs" className="min-w-0">
              <ItemMedia variant="icon">
                <Clock3Icon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>运行时长</ItemTitle>
                <ItemDescription>当前 Gateway 进程</ItemDescription>
              </ItemContent>
              <ItemActions className="gap-1 text-sm">
                <span className="font-medium tabular-nums">{uptimeHours}</span>
                <span className="text-muted-foreground">小时</span>
                <span className="font-medium tabular-nums">
                  {uptimeMinutes}
                </span>
                <span className="text-muted-foreground">分</span>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>网络与安全边界</CardTitle>
            <CardDescription>
              Gateway 只读取路由元数据，敏感请求内容始终保持不透明。
            </CardDescription>
            <CardAction>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
                <LockKeyholeIcon aria-hidden="true" />
                只读
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup className="gap-0">
              <Item>
                <ItemMedia variant="icon">
                  <NetworkIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>监听地址</ItemTitle>
                  <ItemDescription className="truncate font-mono text-xs">
                    {snapshot.settings.gatewayAddress}:
                    {snapshot.settings.gatewayPort}
                  </ItemDescription>
                </ItemContent>
              </Item>
              <ItemSeparator />
              <Item>
                <ItemMedia variant="icon">
                  <RouteIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>Codex 上游</ItemTitle>
                  <ItemDescription className="truncate font-mono text-xs">
                    {snapshot.settings.upstream}
                  </ItemDescription>
                </ItemContent>
              </Item>
              <ItemSeparator />
              <Item>
                <ItemMedia variant="icon">
                  <ShieldCheckIcon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>数据范围</ItemTitle>
                  <ItemDescription>
                    仅检查账号选择所需的只读路由元数据。
                  </ItemDescription>
                </ItemContent>
              </Item>
              <ItemSeparator />
              <Item>
                <ItemMedia variant="icon">
                  <FileLock2Icon />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>敏感内容</ItemTitle>
                  <ItemDescription>
                    Prompt、工具参数、工具输出和响应体永不记录。
                  </ItemDescription>
                </ItemContent>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>

      </div>
    </section>
  )
}
