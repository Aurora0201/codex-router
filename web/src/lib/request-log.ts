import type {
  RequestLogView,
  RequestLogsResponse,
  RequestOutcome,
  RequestState,
} from "@/services/contracts"

type TimelinePoint = RequestLogsResponse["timeline"][number]

/**
 * A row the user picked, from either the table or the live timeline. The
 * timeline carries a subset of the fields, so anything reading one has to ask
 * which it has before reaching past the shared ones.
 */
export type SelectedRequest = RequestLogView | TimelinePoint

export const isFullRequest = (
  value: SelectedRequest
): value is RequestLogView => "route" in value

export function requestProtocol(item: RequestLogView): "GET" | "POST" | "WS" {
  if (
    item.transport === "ws" ||
    (item.transport === "compact" &&
      item.route === "/responses" &&
      item.requestId?.includes(":"))
  )
    return "WS"
  return item.route === "/models" ? "GET" : "POST"
}

export const OUTCOME_LABELS: Record<RequestOutcome, string> = {
  success: "成功",
  rejected: "已拒绝",
  upstream_error: "上游故障",
  gateway_error: "网关故障",
  client_cancelled: "已取消",
}

export const STATE_LABELS: Record<RequestState, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  cancelled: "已取消",
  interrupted: "进程中断",
}
