import { ClipboardIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { LogDetailGroup } from "@/components/request/log-detail-group"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/components/ui/toast"
import { formatBytes, formatLatency } from "@/lib/format"
import {
  OUTCOME_LABELS,
  STATE_LABELS,
  isFullRequest,
  type SelectedRequest,
} from "@/lib/request-log"

export function RequestDetailSheet({
  selected,
  onClose,
}: {
  selected: SelectedRequest | null
  onClose(): void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  if (!selected) return <Sheet open={false} />
  const full = isFullRequest(selected)
  const requestId = full ? selected.requestId : undefined
  const selectedTime = full ? selected.startedAt : selected.createdAt
  const resultLabel =
    full && selected.outcome === null
      ? t(STATE_LABELS[selected.state])
      : t(OUTCOME_LABELS[selected.outcome!])
  const groups = [
    {
      title: t("结果"),
      values: [
        [t("时间"), new Date(selectedTime).toLocaleString(locale)],
        [t("生命周期"), full ? t(STATE_LABELS[selected.state]) : "—"],
        [t("请求结果"), resultLabel],
      ],
    },
    ...(selected.outcome !== "success"
      ? [
          {
            title: t("故障细节"),
            values: [
              [t("失败来源"), full ? (selected.failureSource ?? "—") : "—"],
              [t("失败阶段"), full ? (selected.failureStage ?? "—") : "—"],
              [
                t("HTTP 状态"),
                full
                  ? (selected.httpStatus ?? "—")
                  : (selected.statusCode ?? "—"),
              ],
              [
                t("协议错误码"),
                full ? (selected.protocolErrorCode ?? "—") : "—",
              ],
              [t("诊断码"), full ? (selected.diagnosticCode ?? "—") : "—"],
              [
                t("传输错误链"),
                full && selected.transportErrorChain?.length
                  ? selected.transportErrorChain
                      .map(({ name, code }) =>
                        [name, code].filter(Boolean).join(":")
                      )
                      .join(" → ")
                  : "—",
              ],
              [
                t("上游请求 ID"),
                full ? (selected.upstreamRequestId ?? "—") : "—",
              ],
            ],
          },
        ]
      : []),
    ...(full
      ? [
          {
            title: t("路由"),
            values: [
              [t("路径"), selected.route],
              [t("传输类型"), selected.transport],
              [
                t("账号"),
                selected.identityMode === "client_passthrough"
                  ? t("Codex 默认账号")
                  : (selected.accountLabel ?? t("已删除或未路由")),
              ],
            ],
          },
        ]
      : []),
    {
      title: t("性能"),
      values: [
        [t("耗时"), formatLatency(selected.durationMs)],
        ...(full
          ? [
              [
                t("输入 / 输出"),
                `${formatBytes(selected.bytesIn)} / ${formatBytes(selected.bytesOut)}`,
              ],
            ]
          : []),
      ],
    },
    ...(full
      ? [
          {
            title: t("请求标识"),
            values: [[t("请求 ID"), requestId ?? t("未提供")]],
          },
        ]
      : []),
  ]
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 bg-card data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="px-5 py-5 pr-12">
          <SheetTitle>{t("请求详情")}</SheetTitle>
          <SheetDescription>
            {t("仅包含允许记录的诊断元数据。")}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 p-4 pt-1">
            {groups.map((group) => (
              <LogDetailGroup key={group.title} {...group} />
            ))}
          </div>
        </ScrollArea>
        <SheetFooter className="p-4 sm:flex-row sm:justify-end">
          {requestId && (
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(requestId)
                  .then(() => toast.add({ title: t("请求 ID 已复制") }))
              }
            >
              <ClipboardIcon data-icon="inline-start" />
              {t("复制请求 ID")}
            </Button>
          )}
          <SheetClose render={<Button variant="secondary" />}>
            {t("关闭")}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
