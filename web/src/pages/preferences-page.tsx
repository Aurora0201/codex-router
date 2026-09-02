import { useState } from "react"
import {
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileTextIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  SunIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useTheme, type Theme } from "@/components/theme-provider"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { toast } from "@/components/ui/toast"
import type {
  GatewayService,
  GatewaySnapshot,
  SettingsView,
} from "@/services/contracts"

const themeItems = [
  {
    value: "system",
    label: "跟随系统",
    description: "根据操作系统的外观设置自动切换。",
    icon: MonitorIcon,
  },
  {
    value: "light",
    label: "浅色",
    description: "始终使用明亮的中性色表面。",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "深色",
    description: "始终使用低亮度的中性色表面。",
    icon: MoonIcon,
  },
] as const

function parentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator > 0 ? path.slice(0, separator) : path
}

type EnvironmentItemProps = {
  title: string
  description: string
  icon: typeof PackageIcon
} & (
  | { href: string; disabled?: never; onActivate?: never }
  | { href?: never; disabled?: boolean; onActivate(): void }
)

function EnvironmentItem({
  title,
  description,
  icon: Icon,
  href,
  disabled = false,
  onActivate,
}: EnvironmentItemProps) {
  const render = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={title}
    />
  ) : (
    <button
      type="button"
      disabled={disabled}
      onClick={onActivate}
      aria-label={title}
    />
  )
  return (
    <Item
      variant="outline"
      render={render}
      className="min-w-0 flex-nowrap text-left enabled:cursor-pointer enabled:hover:border-ring/40 enabled:hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <ItemMedia
        variant="icon"
        className="size-10 translate-y-0! self-center! rounded-md bg-muted"
      >
        <Icon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="truncate text-xs">
          {description}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="self-center text-muted-foreground [&_svg]:size-4">
        {href ? (
          <ExternalLinkIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </ItemActions>
    </Item>
  )
}

export function PreferencesPage({
  snapshot,
  service,
  reload,
  onThemeChange,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
  onThemeChange(theme: Theme): Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage?.startsWith("en") ? "en" : "zh-CN"
  const backupDirectory = parentDirectory(snapshot.codex.backupPath)
  const logDirectory = snapshot.health.logFilePath
    ? parentDirectory(snapshot.health.logFilePath)
    : null
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast.add({
        title: t("目录路径已复制"),
        description: path,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: t("无法复制目录路径"),
        description: (error as Error).message,
        type: "error",
      })
    }
  }
  const save = async (
    values: Partial<Pick<SettingsView, "requestMetadataLogging" | "logLevel">>
  ) => {
    setSaving(true)
    try {
      await service.saveSettings(values)
      await reload()
    } catch (error) {
      toast.add({
        title: t("设置保存失败"),
        description: (error as Error).message,
        type: "error",
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="flex w-full flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("偏好设置")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("管理界面外观、诊断元数据和 Codex Router 运行日志。")}
        </p>
      </div>
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("界面外观")}</CardTitle>
            <CardDescription>
              {t("更改会立即保存，并同步到其他管理页面。")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldContent>
                  <FieldTitle>{t("主题")}</FieldTitle>
                  <FieldDescription>
                    {t("选择适合当前环境的显示方式。")}
                  </FieldDescription>
                </FieldContent>
                <Tabs
                  className="w-full"
                  value={theme}
                  onValueChange={(value) => {
                    if (
                      value === "system" ||
                      value === "light" ||
                      value === "dark"
                    )
                      void onThemeChange(value)
                  }}
                >
                  <TabsList className="grid w-full grid-cols-3">
                    {themeItems.map((item) => {
                      const Icon = item.icon
                      return (
                        <TabsTab key={item.value} value={item.value}>
                          <Icon data-icon="inline-start" />
                          {t(item.label)}
                        </TabsTab>
                      )
                    })}
                  </TabsList>
                  <TabsPanels>
                    {themeItems.map((item) => (
                      <TabsPanel
                        key={item.value}
                        value={item.value}
                        className="text-xs text-muted-foreground"
                      >
                        {t(item.description)}
                      </TabsPanel>
                    ))}
                  </TabsPanels>
                </Tabs>
              </Field>
              <Field orientation="horizontal" className="items-center!">
                <FieldContent>
                  <FieldTitle>{t("语言")}</FieldTitle>
                  <FieldDescription>
                    {t("选择管理界面的显示语言。")}
                  </FieldDescription>
                </FieldContent>
                <Select
                  value={language}
                  onValueChange={(next) => {
                    if (next === "zh-CN" || next === "en")
                      void i18n.changeLanguage(next)
                  }}
                >
                  <SelectTrigger className="w-40" aria-label={t("语言")}>
                    <LanguagesIcon />
                    <SelectValue>
                      {language === "en" ? "English" : t("简体中文")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="zh-CN">{t("简体中文")}</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{t("日志记录")}</CardTitle>
            <CardDescription>
              {t("控制安全诊断元数据和 Codex Router 运行日志的详细程度。")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field
                orientation="horizontal"
                className="items-center!"
                data-disabled={saving || undefined}
              >
                <FieldContent>
                  <FieldTitle>{t("请求元数据")}</FieldTitle>
                  <FieldDescription>
                    {t("仅记录状态、耗时、字节数和路由，不记录正文。")}
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={snapshot.settings.requestMetadataLogging}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    void save({ requestMetadataLogging: checked })
                  }
                  aria-label={t("请求元数据记录")}
                />
              </Field>
              <Field data-disabled={saving || undefined}>
                <FieldContent>
                  <FieldTitle>{t("运行日志等级")}</FieldTitle>
                  <FieldDescription>
                    {t("调整后立即应用并在重启后保留。")}
                  </FieldDescription>
                </FieldContent>
                <Tabs
                  className="w-full"
                  value={snapshot.settings.logLevel}
                  onValueChange={(value) =>
                    void save({ logLevel: value as SettingsView["logLevel"] })
                  }
                >
                  <TabsList className="grid w-full grid-cols-4">
                    {["debug", "info", "warn", "error"].map((level) => (
                      <TabsTab key={level} value={level} disabled={saving}>
                        {level.toUpperCase()}
                      </TabsTab>
                    ))}
                  </TabsList>
                </Tabs>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("本地环境")}</CardTitle>
          <CardDescription>
            {t("打开 Codex Router 项目页面，或点击本地目录复制完整路径。")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup className="grid gap-2 md:grid-cols-2">
            <EnvironmentItem
              title={t("Codex Router 版本")}
              description={snapshot.health.version}
              icon={PackageIcon}
              href="https://github.com/Aurora0201/codex-router"
            />
            <EnvironmentItem
              title={t("数据目录")}
              description={snapshot.health.dataDir}
              icon={DatabaseIcon}
              onActivate={() => void copyPath(snapshot.health.dataDir)}
            />
            <EnvironmentItem
              title={t("Codex 配置备份")}
              description={backupDirectory}
              icon={FileArchiveIcon}
              onActivate={() => void copyPath(backupDirectory)}
            />
            <EnvironmentItem
              title={t("Codex Router 运行日志")}
              description={logDirectory ?? t("标准输出模式，没有独立日志目录")}
              icon={FileTextIcon}
              disabled={!logDirectory}
              onActivate={() => {
                if (logDirectory) void copyPath(logDirectory)
              }}
            />
          </ItemGroup>
        </CardContent>
      </Card>
    </section>
  )
}
