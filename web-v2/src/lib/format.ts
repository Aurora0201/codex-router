import type { AuthStatus, UsageWindowView } from "@/services/contracts"

export function shortAccountId(value: string | null): string {
  if (!value) return "Account ID unavailable"
  if (value.length <= 15) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function formatUsageWindow(window: UsageWindowView | null): string {
  const minutes = window?.windowDurationMins
  if (!minutes) return "用量额度"
  if (minutes % 10080 === 0) return `${(minutes / 10080) * 7} 天额度`
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`
  return `${minutes} 分钟额度`
}

export function formatRelativeTime(
  timestamp: number | null,
  now = Date.now()
): string {
  if (!timestamp) return "尚未刷新"
  const diff = Math.max(0, timestamp - now)
  if (diff === 0) {
    const elapsed = Math.max(0, now - timestamp)
    if (elapsed < 60_000) return "刚刚"
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`
    return `${Math.floor(elapsed / 3_600_000)} 小时前`
  }
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)} 分钟后`
  if (diff < 86_400_000) return `${Math.ceil(diff / 3_600_000)} 小时后`
  return `${Math.ceil(diff / 86_400_000)} 天后`
}

export function authStatusLabel(status: AuthStatus): string {
  return {
    login_pending: "等待登录",
    ready: "认证就绪",
    refreshing: "正在刷新",
    rate_limited: "额度受限",
    relogin_required: "需要重新登录",
    unsupported_fedramp: "不支持 FedRAMP",
    disabled: "已停用",
    error: "认证异常",
  }[status]
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} 小时 ${minutes} 分钟`
}
