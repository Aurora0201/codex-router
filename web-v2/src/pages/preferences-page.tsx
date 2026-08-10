import { useState } from "react"
import { ChevronRightIcon, DatabaseIcon, FileArchiveIcon, FileTextIcon, MonitorIcon, MoonIcon, PackageIcon, SunIcon } from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import type { GatewayService, GatewaySnapshot, SettingsView } from "@/services/contracts"

const themeItems = [
  { value: "system", label: "跟随系统", description: "根据操作系统的外观设置自动切换。", icon: MonitorIcon },
  { value: "light", label: "浅色", description: "始终使用明亮的中性色表面。", icon: SunIcon },
  { value: "dark", label: "深色", description: "始终使用低亮度的中性色表面。", icon: MoonIcon },
] as const

function EnvironmentItem({ title, description, icon: Icon, disabled = false, onActivate }: { title: string; description: string; icon: typeof PackageIcon; disabled?: boolean; onActivate(): void }) {
  return (
    <Item variant="outline" render={<button type="button" disabled={disabled} onClick={onActivate} aria-label={title} />} className="min-w-0 flex-nowrap text-left disabled:cursor-not-allowed disabled:opacity-60">
      <ItemMedia variant="icon" className="rounded-md bg-muted p-2"><Icon /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle>{title}</ItemTitle><ItemDescription className="truncate font-mono text-xs">{description}</ItemDescription></ItemContent>
      <ItemActions><ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" /></ItemActions>
    </Item>
  )
}

export function PreferencesPage({ snapshot, service, reload, onThemeChange }: { snapshot: GatewaySnapshot; service: GatewayService; reload(): Promise<void>; onThemeChange(theme: Theme): Promise<void> }) {
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const openEnvironment = async (target: "data" | "backup" | "logs") => {
    try {
      await service.openLocalEnvironment(target)
    } catch (error) {
      toast.add({ title: "无法打开目标目录", description: (error as Error).message, type: "error" })
    }
  }
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
          <CardContent><FieldGroup><Field orientation="horizontal" data-disabled={saving || undefined}><FieldContent><FieldTitle>请求元数据</FieldTitle><FieldDescription>仅记录状态、耗时、字节数和路由，不记录正文。</FieldDescription></FieldContent><Switch checked={snapshot.settings.requestMetadataLogging} disabled={saving} onCheckedChange={(checked) => void save({ requestMetadataLogging: checked })} aria-label="请求元数据记录" /></Field><Field data-disabled={saving || undefined}><FieldContent><FieldTitle>运行日志等级</FieldTitle><FieldDescription>调整后立即应用并在重启后保留。</FieldDescription></FieldContent><Tabs className="w-full" value={snapshot.settings.logLevel} onValueChange={(value) => void save({ logLevel: value as SettingsView["logLevel"] })}><TabsList className="grid w-full grid-cols-4">{["debug", "info", "warn", "error"].map((level) => <TabsTrigger key={level} value={level} disabled={saving}>{level.toUpperCase()}</TabsTrigger>)}</TabsList></Tabs></Field></FieldGroup></CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>本地环境</CardTitle><CardDescription>选择一项可在系统中打开对应目录；版本发布页将在地址配置后启用。</CardDescription></CardHeader>
        <CardContent><ItemGroup className="grid gap-2 md:grid-cols-2">
          <EnvironmentItem title="Codex Router 版本" description={`${snapshot.health.version} · GitHub 发布页即将提供`} icon={PackageIcon} disabled onActivate={() => undefined} />
          <EnvironmentItem title="数据目录" description={snapshot.health.dataDir} icon={DatabaseIcon} onActivate={() => void openEnvironment("data")} />
          <EnvironmentItem title="Codex 配置备份" description={snapshot.codex.backupPath} icon={FileArchiveIcon} onActivate={() => void openEnvironment("backup")} />
          <EnvironmentItem title="Codex Router 运行日志" description={snapshot.health.logFilePath ?? "标准输出模式，没有独立日志目录"} icon={FileTextIcon} disabled={!snapshot.health.logFilePath} onActivate={() => void openEnvironment("logs")} />
        </ItemGroup></CardContent>
      </Card>
    </section>
  )
}
