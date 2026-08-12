import { useEffect, useState } from "react"
import { RadioIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GatewayService, WebSocketConnectionLogView } from "@/services/contracts"

const LABELS:Record<WebSocketConnectionLogView["outcome"],string>={connected:"已连接",rejected:"握手拒绝",failed:"连接失败",retired:"正常退役",closed:"已关闭"}
const value=(input:unknown)=>input===undefined||input===null?"—":String(input)

export function WebSocketConnectionLogsPanel({service,revision}:{service:GatewayService;revision:number}){
  const {t}=useTranslation();const [items,setItems]=useState<WebSocketConnectionLogView[]>([]);const [selected,setSelected]=useState<WebSocketConnectionLogView|null>(null)
  useEffect(()=>{void service.getWebSocketConnectionLogs({range:"24h",page:1,limit:50}).then((result)=>setItems(result.items))},[revision,service])
  return <>
    <Card className="gap-0 overflow-hidden"><CardHeader className="border-b"><CardTitle>{t("WebSocket 连接诊断")}</CardTitle><CardDescription>{t("握手与关闭证据独立于请求结果，不参与请求成功率。")}</CardDescription></CardHeader><CardContent className="p-0">
      {items.length===0?<Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><RadioIcon/></EmptyMedia><EmptyTitle>{t("没有连接诊断记录")}</EmptyTitle><EmptyDescription>{t("WebSocket 建立或关闭后会显示在这里。")}</EmptyDescription></EmptyHeader></Empty>:<Table><TableHeader><TableRow><TableHead className="pl-4">{t("时间与结果")}</TableHead><TableHead>{t("连接")}</TableHead><TableHead>{t("握手 HTTP")}</TableHead><TableHead>{t("关闭码")}</TableHead><TableHead>{t("关闭原因")}</TableHead></TableRow></TableHeader><TableBody>{items.map((item)=><TableRow key={item.id} role="button" tabIndex={0} className="h-11 cursor-pointer" onClick={()=>setSelected(item)} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" ")setSelected(item)}}><TableCell className="pl-4"><span className="inline-flex items-center gap-2"><span className="tabular-nums">{new Date(item.startedAt).toLocaleTimeString()}</span><span>{t(LABELS[item.outcome])}</span></span></TableCell><TableCell><span className="block truncate">{item.connectionId}</span></TableCell><TableCell className="tabular-nums">{value(item.handshakeHttpStatus)}</TableCell><TableCell className="tabular-nums">{value(item.clientCloseCode??item.upstreamCloseCode)}</TableCell><TableCell><span className="block truncate">{value(item.closeReasonCode)}</span></TableCell></TableRow>)}</TableBody></Table>}
    </CardContent></Card>
    {selected?<Sheet open onOpenChange={(open)=>!open&&setSelected(null)}><SheetContent><SheetHeader><SheetTitle>{t("连接诊断详情")}</SheetTitle><SheetDescription>{t("仅包含握手和关闭元数据。")}</SheetDescription></SheetHeader><div className="grid grid-cols-[8rem_1fr] gap-3 px-4 text-sm">{[[t("连接 ID"),selected.connectionId],[t("结果"),t(LABELS[selected.outcome])],[t("握手 HTTP"),value(selected.handshakeHttpStatus)],[t("客户端关闭码"),value(selected.clientCloseCode)],[t("上游关闭码"),value(selected.upstreamCloseCode)],[t("关闭发起方"),value(selected.closeInitiator)],[t("关闭原因"),value(selected.closeReasonCode)]].map(([label,entry])=><><span key={`${label}-label`} className="text-muted-foreground">{label}</span><span key={`${label}-value`} className="break-all">{entry}</span></>)}</div></SheetContent></Sheet>:null}
  </>
}
