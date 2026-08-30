import {
  BanIcon,
  BadgeCheckIcon,
  Clock3Icon,
  GaugeIcon,
  ShieldOffIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { authStatusLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

export function AccountStatus({ account }: { account: AccountView }) {
  const label = authStatusLabel(account.authStatus)

  if (
    account.authStatus === "refreshing" ||
    account.authStatus === "checking"
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Spinner />
        {label}
      </span>
    )
  }

  const status = {
    login_pending: { tone: "muted" as const, icon: Clock3Icon },
    ready: { tone: "primary" as const, icon: BadgeCheckIcon },
    rate_limited: { tone: "warning" as const, icon: GaugeIcon },
    relogin_required: {
      tone: "destructive" as const,
      icon: TriangleAlertIcon,
    },
    unsupported_fedramp: {
      tone: "destructive" as const,
      icon: ShieldOffIcon,
    },
    disabled: { tone: "muted" as const, icon: BanIcon },
    error: { tone: "destructive" as const, icon: TriangleAlertIcon },
  }[account.authStatus]
  const Icon = status.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium [&_svg]:size-3.5",
        status.tone === "muted" && "text-muted-foreground",
        status.tone === "primary" && "text-primary",
        status.tone === "warning" && "text-warning",
        status.tone === "destructive" && "text-destructive"
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </span>
  )
}
