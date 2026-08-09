export function shortAccountId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function formatRelativeTime(timestamp: number | null) {
  if (timestamp == null) return "—"
  const minutes = Math.max(0, Math.round((timestamp - Date.now()) / 60_000))
  if (minutes > 0) return `${minutes < 60 ? `${minutes} 分钟` : `${Math.round(minutes / 60)} 小时`}后`
  const ago = Math.abs(minutes)
  return ago < 1 ? "刚刚" : `${ago < 60 ? `${ago} 分钟` : `${Math.round(ago / 60)} 小时`}前`
}

export function formatWindowDuration(minutes: number | null) {
  if (minutes == null) return "—"
  if (minutes < 60) return `${minutes} 分钟窗口`
  if (minutes < 1440) return `${minutes / 60} 小时窗口`
  return `${Math.round(minutes / 1440)} 天窗口`
}

export function formatUsageWindowName(minutes: number | null, fallback = "用量额度") {
  if (minutes == null) return fallback
  if (minutes < 60) return `${minutes} 分钟额度`
  if (minutes < 1440) return `${minutes / 60} 小时额度`
  return `${Math.round(minutes / 1440)} 天额度`
}
