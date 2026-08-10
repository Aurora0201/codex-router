import { useState } from "react"
import { ClipboardIcon, DatabaseIcon, FileArchiveIcon, FileTextIcon, MonitorIcon, MoonIcon, PackageIcon, SunIcon } from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { GatewayService, GatewaySnapshot, SettingsView } from "@/services/contracts"

const themeItems = [
  { value: "system", label: "跟随系统", description: "根据操作系统的外观设置自动切换。", icon: MonitorIcon },
  { value: "light", label: "浅色", description: "始终使用明亮的中性色表面。", icon: SunIcon },
  { value: "dark", label: "深色", description: "始终使用低亮度的中性色表面。", icon: MoonIcon },
] as const

function CopyPath({ value, label }: { value: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`复制${label}`} onClick={() => void navigator.clipboard.writeText(value).then(() => toast.add({ title: `${label}已复制` }))} />}><ClipboardIcon /></TooltipTrigger>
      <TooltipContent>复制{label}</TooltipContent>
    </Tooltip>
  )
}

function EnvironmentItem({ title, value, detail, icon: Icon, copyable = true }: { title: string; value: string; detail?: string; icon: typeof PackageIcon; copyable?: boolean }) {
  return (
    <Item variant="muted" className="grid min-w-0 grid-cols-[auto_1fr_auto] items-start">
      <ItemMedia variant="icon" className="self-start translate-y-0"><Icon /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="h-7 items-center">{title}</ItemTitle>
        <HoverCard>
          <HoverCardTrigger render={<button type="button" className="block max-w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
            <span className="block truncate font-mono text-xs text-muted-foreground underline decoration-border underline-offset-4">{value}</span>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-96">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{title}</p>
              <p className="break-all font-mono text-xs text-muted-foreground">{value}</p>
              {detail ? <p className="break-all text-xs text-muted-foreground">{detail}</p> : null}
            </div>
          </HoverCardContent>
        </HoverCard>
      </ItemContent>
      {copyable ? <ItemActions className="self-start"><CopyPath value={value} label={title} /></ItemActions> : null}
    </Item>
  )
}

export function PreferencesPage({ snapshot, service, reload, onThemeChange }: { snapshot: GatewaySnapshot; service: GatewayService; reload(): Promise<void>; onThemeChange(theme: Theme): Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const save = async (values: Partial<Pick<SettingsView, "requestMetadataLogging" | "logLevel">>) => {
    setSaving(true)
    try {
      await service.saveSettings(values)
      await reload()
    } catch (error) {
      toast.add({ title: "设置保存失败", description: (error as Error).message, type: "error" })
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="flex w-full flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">偏好设置</h1><p className="mt-1 text-sm text-muted-foreground">管理界面外观、诊断元数据和 Codex Router 运行日志。</p></div>
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <Card className="h-full">
          <CardHeader><CardTitle>界面外观</CardTitle><CardDescription>更改会立即保存，并同步到其他管理页面。</CardDescription></CardHeader>
          <CardContent><FieldGroup><Field><FieldContent><FieldTitle>主题</FieldTitle><FieldDescription>选择适合当前环境的显示方式。</FieldDescription></FieldContent><Tabs className="w-full" value={theme} onValueChange={(value) => { if (value === "system" || value === "light" || value === "dark") void onThemeChange(value) }}><TabsList className="grid w-full grid-cols-3">{themeItems.map((item) => { const Icon = item.icon; return <TabsTrigger key={item.value} value={item.value}><Icon data-icon="inline-start" />{item.label}</TabsTrigger> })}</TabsList>{themeItems.map((item) => <TabsContent key={item.value} value={item.value} className="text-xs text-muted-foreground">{item.description}</TabsContent>)}</Tabs></Field></FieldGroup></CardContent>
        </Card>
        <Card className="h-full">
          <CardHeader><CardTitle>日志记录</CardTitle><CardDescription>控制安全诊断元数据和 Codex Router 运行日志的详细程度。</CardDescription></CardHeader>
          <CardContent><FieldGroup><Field orientation="horizontal" data-disabled={saving || undefined}><FieldContent><FieldTitle>请求元数据</FieldTitle><FieldDescription>仅记录状态、耗时、字节数和路由，不记录正文。</FieldDescription></FieldContent><Switch checked={snapshot.settings.requestMetadataLogging} disabled={saving} onCheckedChange={(checked) => void save({ requestMetadataLogging: checked })} aria-label="请求元数据记录" /></Field><Field orientation="horizontal" data-disabled={saving || undefined}><FieldContent><FieldTitle>运行日志等级</FieldTitle><FieldDescription>调整后立即应用并在重启后保留。</FieldDescription></FieldContent><Select value={snapshot.settings.logLevel} onValueChange={(value) => value && void save({ logLevel: value as SettingsView["logLevel"] })} disabled={saving}><SelectTrigger className="w-36" aria-label="运行日志等级"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["debug", "info", "warn", "error"].map((level) => <SelectItem key={level} value={level}>{level.toUpperCase()}</SelectItem>)}</SelectGroup></SelectContent></Select></Field></FieldGroup></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>本地环境</CardTitle><CardDescription>悬停路径可查看完整位置，复制操作保持在标题行右侧。</CardDescription></CardHeader>
        <CardContent><ItemGroup className="grid grid-cols-4 gap-3">
          <EnvironmentItem title="Codex Router 版本" value={snapshot.health.version} icon={PackageIcon} copyable={false} />
          <EnvironmentItem title="数据目录" value={snapshot.health.dataDir} detail={`数据库：${snapshot.health.databasePath}`} icon={DatabaseIcon} />
          <EnvironmentItem title="Codex 配置备份" value={snapshot.codex.backupPath} icon={FileArchiveIcon} />
          <EnvironmentItem title="Codex Router 运行日志" value={snapshot.health.logFilePath ?? "标准输出"} detail={snapshot.health.logFilePath ? undefined : "前台开发模式没有独立日志文件。"} icon={FileTextIcon} copyable={snapshot.health.logFilePath !== null} />
        </ItemGroup></CardContent>
      </Card>
    </section>
  )
}
