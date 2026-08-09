import { ArrowRight, CircleGauge, ShieldX, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { shortAccountId } from "@/lib/format"
import type { Account } from "@/services/contracts"

export function TransportTrace({ account, online }: { account?: Account; online: boolean }) {
  const ready = online && account?.enabled && account.authStatus === "ready"
  return <Card className="overflow-hidden bg-primary text-primary-foreground"><CardContent className="flex min-h-52 flex-col justify-between gap-8 p-6"><div><div className="flex items-center justify-between gap-3"><p className="text-sm text-primary-foreground/65">实时路由</p><Badge variant={ready ? "secondary" : "destructive"}>{ready ? "下一次请求已就绪" : "请求将被阻断"}</Badge></div><h1 className="mt-2 text-2xl font-semibold tracking-tight">所有流量使用手动选择的账号</h1><p className="mt-2 max-w-xl text-sm text-primary-foreground/70">不会自动轮换、故障转移或根据用量切换账号。</p></div><div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 rounded-2xl bg-primary-foreground/10 px-3 py-2 font-mono text-sm"><CircleGauge />Gateway</span><ArrowRight className="size-4 opacity-60" /><span className="flex items-center gap-2 rounded-2xl bg-primary-foreground px-3 py-2 font-mono text-sm text-primary">{ready ? <UserRound /> : <ShieldX />}{account ? shortAccountId(account.chatgptAccountId) : "no_active_account_selected"}</span></div></CardContent></Card>
}
