import { useState } from "react"
import {
  LockKeyholeIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react"

import { useTheme, type Theme } from "@/components/theme-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import type { GatewayService, GatewaySnapshot } from "@/services/contracts"

const themeItems = [
  { value: "system", label: "跟随系统", description: "根据操作系统的外观设置自动切换。", icon: MonitorIcon },
  { value: "light", label: "浅色", description: "始终使用明亮的 Neutral 表面。", icon: SunIcon },
  { value: "dark", label: "深色", description: "始终使用低亮度的 Neutral 表面。", icon: MoonIcon },
] as const

export function PreferencesPage({ snapshot, service, reload, onThemeChange }: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
  onThemeChange(theme: Theme): Promise<void>
}) {
  const [metadataOverride, setMetadataOverride] = useState<boolean | null>(null)
  const [savingMetadata, setSavingMetadata] = useState(false)
  const metadata = metadataOverride ?? snapshot.settings.requestMetadataLogging
  const { theme } = useTheme()

  const changeMetadata = async (checked: boolean) => {
    const previous = metadata
    setMetadataOverride(checked)
    setSavingMetadata(true)
    try {
      await service.saveSettings({ requestMetadataLogging: checked })
      await reload()
    } catch (error) {
      setMetadataOverride(previous)
      toast.add({ title: "设置保存失败", description: (error as Error).message, type: "error" })
    } finally {
      setMetadataOverride(null)
      setSavingMetadata(false)
    }
  }

  return (
    <section className="flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">偏好设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理界面的外观与允许记录的诊断元数据。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>外观与隐私</CardTitle>
          <CardDescription>更改会立即保存到 Gateway，并同步到其他管理页面。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldTitle>主题</FieldTitle>
                <FieldDescription>选择后立即应用并保存。</FieldDescription>
              </FieldContent>
              <Tabs className="w-full max-w-md" value={theme} onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") void onThemeChange(value)
              }}>
                <TabsList className="grid w-full grid-cols-3">
                  {themeItems.map((item) => {
                    const Icon = item.icon
                    return <TabsTrigger key={item.value} value={item.value}><Icon data-icon="inline-start" />{item.label}</TabsTrigger>
                  })}
                </TabsList>
                {themeItems.map((item) => <TabsContent key={item.value} value={item.value} className="text-xs text-muted-foreground">{item.description}</TabsContent>)}
              </Tabs>
            </Field>
            <Field orientation="horizontal" data-disabled={savingMetadata || undefined}>
              <FieldContent>
                <FieldTitle>Request metadata logging</FieldTitle>
                <FieldDescription>仅记录状态、耗时、字节数和路由哈希。</FieldDescription>
              </FieldContent>
              <Switch checked={metadata} disabled={savingMetadata} onCheckedChange={(checked) => void changeMetadata(checked)} aria-label="Request metadata logging" />
            </Field>
            <Field orientation="horizontal" data-disabled>
              <FieldContent>
                <FieldTitle>Prompt logging</FieldTitle>
                <FieldDescription>Prompt、工具参数、工具输出和响应体永不记录。</FieldDescription>
              </FieldContent>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5"><LockKeyholeIcon aria-hidden="true" />锁定关闭</span>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
    </section>
  )
}
