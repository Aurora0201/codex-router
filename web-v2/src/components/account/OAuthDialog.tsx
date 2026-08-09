import { useEffect, useState } from "react"
import { CheckCircle2, Copy, ExternalLink, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import type { GatewayService, LoginSession } from "@/services/contracts"

const progress = { launching: 15, waiting: 40, completing: 75, complete: 100, failed: 100, cancelled: 0 } as const
const copy = { launching: "正在准备官方登录", waiting: "等待浏览器授权", completing: "正在读取账号信息", complete: "账号添加成功", failed: "登录失败", cancelled: "登录已取消" } as const

export function OAuthDialog({ open, onOpenChange, service, onComplete }: { open: boolean; onOpenChange(open: boolean): void; service: GatewayService; onComplete(): void }) {
  const [session, setSession] = useState<LoginSession | null>(null)
  const [error, setError] = useState("")
  const terminal = session && ["complete", "failed", "cancelled"].includes(session.status)

  useEffect(() => {
    if (!open || session || error) return
    void service.startLogin().then(setSession).catch((reason: Error) => setError(reason.message))
  }, [error, open, service, session])

  useEffect(() => {
    if (!session || terminal) return
    const timer = window.setTimeout(() => void service.getLogin(session.loginId).then((next) => { setSession(next); if (next.status === "complete") onComplete() }).catch((reason: Error) => setError(reason.message)), 700)
    return () => window.clearTimeout(timer)
  }, [onComplete, service, session, terminal])

  const reset = () => { setSession(null); setError("") }
  const close = (next: boolean) => { if (!next) reset(); onOpenChange(next) }

  return <Dialog open={open} onOpenChange={close}><DialogContent><DialogHeader><DialogTitle>添加 ChatGPT 账号</DialogTitle><DialogDescription>完整模拟 Codex Browser OAuth；不会打开真实页面或发送网络请求。</DialogDescription></DialogHeader>{error ? <Alert variant="destructive"><AlertTitle>无法启动登录</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : session ? <div className="space-y-4"><div className="flex items-center justify-between"><Badge variant={session.status === "complete" ? "default" : session.status === "failed" ? "destructive" : "secondary"}>{!terminal && <Spinner />}{copy[session.status]}</Badge><span className="font-mono text-xs text-muted-foreground">{progress[session.status]}%</span></div><Progress value={progress[session.status]} />{session.status === "waiting" && <Alert><AlertTitle>模拟登录页已准备</AlertTitle><AlertDescription>真实接入后这里会打开 OpenAI 官方授权页面；当前点击只推进 Mock 状态。</AlertDescription></Alert>}{session.status === "complete" && <Alert><CheckCircle2 /><AlertTitle>授权完成</AlertTitle><AlertDescription>新账号已加入列表，请手动选择为当前账号。</AlertDescription></Alert>}{session.status === "failed" && <Alert variant="destructive"><XCircle /><AlertTitle>授权失败</AlertTitle><AlertDescription>{session.error}</AlertDescription></Alert>}<div className="flex flex-wrap gap-2">{session.status === "waiting" && <><Button variant="secondary" onClick={() => toast.info("Mock 登录页：未发起网络请求")}><ExternalLink />打开模拟登录页</Button><Button variant="ghost" onClick={() => { void navigator.clipboard.writeText(session.authUrl); toast.success("模拟链接已复制") }}><Copy />复制链接</Button><Button variant="destructive" onClick={() => void service.cancelLogin(session.loginId).then(setSession)}>取消登录</Button></>}{session.status === "failed" && <Button onClick={reset}>重试</Button>}</div></div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Spinner />启动 Mock OAuth…</div>}<DialogFooter><Button variant="outline" onClick={() => close(false)}>{terminal ? "完成" : "关闭"}</Button></DialogFooter></DialogContent></Dialog>
}
