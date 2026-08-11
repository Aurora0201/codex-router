import { useEffect, useState } from "react"
import {
  BanIcon,
  CircleCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { GatewayService, LoginSessionView } from "@/services/contracts"

function LoginStatus({ status }: { status: LoginSessionView["status"] }) {
  const { t } = useTranslation()
  const copy = {
    waiting: "等待授权",
    complete: "授权完成",
    cancelled: "已取消",
    failed: "授权失败",
  }[status]

  const Icon =
    status === "complete"
      ? CircleCheckIcon
      : status === "cancelled"
        ? BanIcon
        : TriangleAlertIcon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium [&_svg]:size-4",
        status === "complete" && "text-success",
        status === "waiting" && "text-muted-foreground",
        status === "cancelled" && "text-muted-foreground",
        status === "failed" && "text-destructive"
      )}
      role="status"
    >
      {status === "waiting" ? <Spinner /> : <Icon aria-hidden="true" />}
      {t(copy)}
    </span>
  )
}

export function OAuthDialog({
  service,
  onComplete,
}: {
  service: GatewayService
  onComplete(): Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<LoginSessionView | null>(null)
  const [busy, setBusy] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (!open || session?.status !== "waiting") return
    const timer = window.setInterval(() => {
      void service
        .getLoginStatus(session.loginId)
        .then(async (next) => {
          setSession(next)
          if (next.status === "complete") {
            await onComplete()
            toast.add({
              title: t("账号已添加"),
              description: t("请手动选择当前路由账号。"),
              type: "success",
            })
          }
        })
        .catch((error: Error) => {
          setSession({ ...session, status: "failed", error: error.message })
        })
    }, 900)
    return () => window.clearInterval(timer)
  }, [onComplete, open, service, session, t])

  const start = async () => {
    setBusy(true)
    try {
      setSession(await service.startLogin())
    } catch (error) {
      toast.add({
        title: t("无法启动登录"),
        description: (error as Error).message,
        type: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!session) return
    setBusy(true)
    try {
      await service.cancelLogin(session.loginId)
      setSession({ ...session, status: "cancelled" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        onClick={() => {
          setOpen(true)
          setSession(null)
        }}
      >
        <PlusIcon data-icon="inline-start" />
        {t("添加账号")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("添加 ChatGPT/Codex 账号")}</DialogTitle>
            <DialogDescription>
              {t("使用 Codex 官方 Browser OAuth。Codex Router 不会读取浏览器 Cookie，账号凭据保存在独立目录中。")}
            </DialogDescription>
          </DialogHeader>
          {!session ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("启动登录会话后，请在官方授权页面完成账号登录。")}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t("取消")}
                </Button>
                <Button disabled={busy} onClick={() => void start()}>
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ExternalLinkIcon data-icon="inline-start" />
                  )}
                  {busy ? t("启动中") : t("启动登录")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-5">
                <LoginStatus status={session.status} />
                <p className="text-sm text-muted-foreground">
                  {session.status === "waiting"
                    ? t("授权会话已准备好，请打开下面的链接完成登录。")
                    : session.status === "complete"
                      ? t("新账号已安全写入 Codex Router 账号池。")
                      : (session.error ?? t("登录流程未完成。"))}
                </p>
                <div className="rounded-xl bg-muted p-3 font-mono text-xs break-all">
                  {session.authUrl}
                </div>
              </div>
              <DialogFooter className="sm:flex-wrap">
                {session.status === "waiting" ? (
                  <>
                    <a
                      className={buttonVariants()}
                      href={session.authUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      {t("打开授权页面")}
                    </a>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(session.authUrl)
                        toast.add({ title: t("链接已复制"), type: "success" })
                      }}
                    >
                      <CopyIcon data-icon="inline-start" />
                      {t("复制链接")}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void cancel()}
                    >
                      {t("取消登录")}
                    </Button>
                  </>
                ) : session.status === "failed" ||
                  session.status === "cancelled" ? (
                  <Button onClick={() => void start()}>{t("重试")}</Button>
                ) : null}
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  {t("完成")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
