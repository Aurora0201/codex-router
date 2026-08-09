import { LoaderCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { AccountAuthStatus } from "@/services/contracts"

const labels: Record<AccountAuthStatus, string> = { ready: "可用", refreshing: "刷新中", rate_limited: "已限流", relogin_required: "需要重新登录", unsupported_fedramp: "不支持 FedRAMP", disabled: "已停用", login_pending: "等待登录", error: "错误" }

export function AccountStatusBadge({ status }: { status: AccountAuthStatus }) {
  const variant = status === "ready" ? "default" : status === "refreshing" || status === "login_pending" ? "secondary" : status === "disabled" ? "outline" : "destructive"
  return <Badge variant={variant}>{status === "refreshing" && <LoaderCircle className="animate-spin" />}{labels[status]}</Badge>
}
