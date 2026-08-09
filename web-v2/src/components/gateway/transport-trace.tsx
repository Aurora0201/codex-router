import {
  ArrowRightIcon,
  BanIcon,
  CircleGaugeIcon,
  LaptopIcon,
  UserRoundIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { shortAccountId } from "@/lib/format"

function TraceNode({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof LaptopIcon
  label: string
  detail: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-background p-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  )
}

export function TransportTrace({ accountId }: { accountId: string | null }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>实时路由</CardTitle>
        <CardDescription>
          数据面保持透明，只读取选路所需的账号元数据。
        </CardDescription>
        <CardAction>
          <Badge variant={accountId ? "default" : "secondary"}>
            {accountId ? "链路已建立" : "安全阻断"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
          <TraceNode
            icon={LaptopIcon}
            label="Codex Client"
            detail="localhost"
          />
          <ArrowRightIcon
            className="mx-auto shrink-0 rotate-90 text-muted-foreground md:rotate-0"
            aria-hidden="true"
          />
          <TraceNode
            icon={CircleGaugeIcon}
            label="Local Gateway"
            detail="127.0.0.1:8317"
          />
          <ArrowRightIcon
            className="mx-auto shrink-0 rotate-90 text-muted-foreground md:rotate-0"
            aria-hidden="true"
          />
          {accountId ? (
            <TraceNode
              icon={UserRoundIcon}
              label="Active Account"
              detail={shortAccountId(accountId)}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-dashed bg-muted/40 p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <BanIcon aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">未选择账号</p>
                <p className="text-xs text-muted-foreground">
                  请求不会离开 Gateway
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
