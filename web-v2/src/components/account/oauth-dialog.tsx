import { useEffect, useState } from "react"
import { CopyIcon, ExternalLinkIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import type { GatewayService, LoginSessionView } from "@/services/contracts"

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
              title: "账号已添加",
              description: "请手动选择当前路由账号。",
              type: "success",
            })
          }
        })
        .catch((error: Error) => {
          setSession({ ...session, status: "failed", error: error.message })
        })
    }, 900)
    return () => window.clearInterval(timer)
  }, [onComplete, open, service, session])

  const start = async () => {
    setBusy(true)
    try {
      setSession(await service.startLogin())
    } catch (error) {
      toast.add({
        title: "无法启动登录",
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
        添加账号
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 ChatGPT/Codex 账号</DialogTitle>
            <DialogDescription>
              模拟 Codex 官方 Browser
              OAuth。此版本不会连接真实登录服务，也不会读取浏览器 Cookie。
            </DialogDescription>
          </DialogHeader>
          {!session ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                启动后将生成一个模拟授权会话，并自动演示等待与完成状态。
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button disabled={busy} onClick={() => void start()}>
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ExternalLinkIcon data-icon="inline-start" />
                  )}
                  {busy ? "启动中" : "启动模拟登录"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Badge
                  variant={
                    session.status === "complete"
                      ? "default"
                      : session.status === "waiting"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {session.status === "waiting"
                    ? "等待授权"
                    : session.status === "complete"
                      ? "授权完成"
                      : session.status === "cancelled"
                        ? "已取消"
                        : "授权失败"}
                </Badge>
                {session.status === "waiting" ? <Spinner /> : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {session.status === "waiting"
                  ? "模拟登录窗口已准备好，稍后将自动完成授权。"
                  : session.status === "complete"
                    ? "新账号已写入 Mock 数据。"
                    : (session.error ?? "登录流程未完成。")}
              </p>
              <div className="rounded-xl bg-muted p-3 font-mono text-xs break-all">
                {session.authUrl}
              </div>
              <DialogFooter>
                {session.status === "waiting" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(session.authUrl)
                        toast.add({ title: "链接已复制", type: "success" })
                      }}
                    >
                      <CopyIcon data-icon="inline-start" />
                      复制链接
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void cancel()}
                    >
                      取消登录
                    </Button>
                  </>
                ) : session.status === "failed" ||
                  session.status === "cancelled" ? (
                  <Button onClick={() => void start()}>重试</Button>
                ) : null}
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  完成
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
