import { useState } from "react"
import { ClipboardIcon, DatabaseIcon, FileArchiveIcon, FileTextIcon, MonitorIcon, MoonIcon, PackageIcon, SunIcon } from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GatewayService, GatewaySnapshot, SettingsView } from "@/services/contracts"

const themeItems = [
  { value: "system", label: "跟随系统", description: "根据操作系统的外观设置自动切换。", icon: MonitorIcon },
  { value: "light", label: "浅色", description: "始终使用明亮的 Neutral 表面。", icon: SunIcon },
  { value: "dark", label: "深色", description: "始终使用低亮度的 Neutral 表面。", icon: MoonIcon },
] as const

function CopyPath({ value, label }: { value: string; label: string }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`复制${label}`} onClick={() => void navigator.clipboard.writeText(value).then(() => toast.add({ title: `${label}已复制` }))} />}><ClipboardIcon /></TooltipTrigger><TooltipContent>复制{label}</TooltipContent></Tooltip>
}

export function PreferencesPage({ snapshot, service, reload, onThemeChange }: { snapshot: GatewaySnapshot; service: GatewayService; reload(): Promise<void>; onThemeChange(theme: Theme): Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const save = async (values: Partial<Pick<SettingsView, "requestMetadataLogging" | "logLevel">>) => {
    setSaving(true)
    try { await service.saveSettings(values); await reload() }
    catch (error) { toast.add({ title: "设置保存失败", description: (error as Error).message, type: "error" }) }
    finally { setSaving(false) }
  }
  const environment = [
    { title: "Gateway 版本", value: snapshot.health.version, icon: PackageIcon },
    { title: "数据目录", value: snapshot.health.dataDir, description: `数据库：${snapshot.health.databasePath}`, icon: DatabaseIcon },
    { title: "Codex 配置备份", value: snapshot.codex.backupPath, icon: FileArchiveIcon },
    { title: "Gateway 文本日志", value: snapshot.health.logFilePath ?? "标准输出", icon: FileTextIcon },
  ]
  return <section className="flex w-full flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">偏好设置</h1><p className="mt-1 text-sm text-muted-foreground">管理界面外观、诊断元数据和 Gateway 运行日志。</p></div>
    <div className="grid items-stretch gap-4 xl:grid-cols-2">
      <Card className="h-full"><CardHeader><CardTitle>界面外观</CardTitle><CardDescription>更改会立即保存，并同步到其他管理页面。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldContent><FieldTitle>主题</FieldTitle><FieldDescription>选择适合当前环境的显示方式。</FieldDescription></FieldContent><Tabs className="w-full" value={theme} onValueChange={(value) => { if (value === "system" || value === "light" || value === "dark") void onThemeChange(value) }}><TabsList className="grid w-full grid-cols-3">{themeItems.map((item) => { const Icon = item.icon; return <TabsTrigger key={item.value} value={item.value}><Icon data-icon="inline-start" />{item.label}</TabsTrigger> })}</TabsList>{themeItems.map((item) => <TabsContent key={item.value} value={item.value} className="text-xs text-muted-foreground">{item.description}</TabsContent>)}</Tabs></Field></FieldGroup></CardContent></Card>
      <Card className="h-full"><CardHeader><CardTitle>日志记录</CardTitle><CardDescription>控制安全诊断元数据和 Gateway 自身运行日志的详细程度。</CardDescription></CardHeader><CardContent><FieldGroup><Field orientation="horizontal" data-disabled={saving || undefined}><FieldContent><FieldTitle>请求元数据</FieldTitle><FieldDescription>仅记录状态、耗时、字节数和路由，不记录正文。</FieldDescription></FieldContent><Switch checked={snapshot.settings.requestMetadataLogging} disabled={saving} onCheckedChange={(checked) => void save({ requestMetadataLogging: checked })} aria-label="请求元数据记录" /></Field><Field orientation="horizontal" data-disabled={saving || undefined}><FieldContent><FieldTitle>运行日志等级</FieldTitle><FieldDescription>调整后立即应用并在重启后保留。</FieldDescription></FieldContent><Select value={snapshot.settings.logLevel} onValueChange={(value) => value && void save({ logLevel: value as SettingsView["logLevel"] })} disabled={saving}><SelectTrigger className="w-36" aria-label="运行日志等级"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["debug","info","warn","error"].map((level) => <SelectItem key={level} value={level}>{level.toUpperCase()}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup></CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle>本地环境</CardTitle><CardDescription>运行版本与本地文件位置，仅供诊断和备份使用。</CardDescription></CardHeader><CardContent><ItemGroup className="grid grid-cols-4 gap-3">{environment.map((entry) => { const Icon = entry.icon; const copyable = entry.title !== "Gateway 版本" && entry.value !== "标准输出"; return <Item key={entry.title} variant="muted" className="min-w-0"><ItemMedia variant="icon"><Icon /></ItemMedia><ItemContent className="min-w-0"><ItemTitle>{entry.title}</ItemTitle><ItemDescription className="truncate font-mono text-xs" title={entry.value}>{entry.value}</ItemDescription>{entry.description && <ItemDescription className="truncate text-[11px]" title={entry.description}>{entry.description}</ItemDescription>}</ItemContent>{copyable && <ItemActions><CopyPath value={entry.value} label={entry.title} /></ItemActions>}</Item> })}</ItemGroup></CardContent></Card>
  </section>
}
