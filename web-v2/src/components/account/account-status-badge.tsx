import { Badge } from "@/components/ui/badge"
import { authStatusLabel } from "@/lib/format"
import type { AccountView } from "@/services/contracts"

export function AccountStatusBadge({ account }: { account: AccountView }) {
  const variant =
    account.authStatus === "ready"
      ? "default"
      : account.authStatus === "rate_limited" ||
          account.authStatus === "refreshing"
        ? "secondary"
        : "destructive"

  return <Badge variant={variant}>{authStatusLabel(account.authStatus)}</Badge>
}
