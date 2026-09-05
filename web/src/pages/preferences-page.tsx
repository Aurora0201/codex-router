import { useId, useState, type ReactNode } from "react"
import {
  CopyIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileTextIcon,
  MonitorIcon,
  MoonIcon,
  PackageIcon,
  PaletteIcon,
  SunIcon,
  TerminalIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useTheme, type Theme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  Tabs,
  TabsList,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { toast } from "@/components/ui/toast"
import type {
  GatewayService,
  GatewaySnapshot,
  SettingsView,
} from "@/services/contracts"

const themeItems = [
  { value: "system", label: "跟随系统", icon: MonitorIcon },
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "dark", label: "深色", icon: MoonIcon },
] as const

function parentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator > 0 ? path.slice(0, separator) : path
}

function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string
  description: string
  icon: typeof PaletteIcon
  children: ReactNode
}) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 gap-4 py-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8"
    >
      <div>
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          {title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        data-slot="settings-surface"
        className="min-w-0 rounded-xl bg-muted px-4"
      >
        {children}
      </div>
    </section>
  )
}

function DirectoryRow({
  title,
  path,
  icon: Icon,
  disabled,
  onCopy,
}: {
  title: string
  path: string
  icon: typeof DatabaseIcon
  disabled?: boolean
  onCopy(): void
}) {
  return (
    <div className="grid min-w-0 gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {title}
      </dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          title={path}
          className="min-w-0 flex-1 truncate text-sm font-medium"
        >
          {path}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={title}
          title={title}
          disabled={disabled}
          onClick={onCopy}
        >
          <CopyIcon aria-hidden="true" />
        </Button>
      </dd>
    </div>
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
    <section className="mx-auto flex w-full max-w-5xl flex-col pb-6">
      <div className="pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("偏好设置")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("管理界面外观、诊断元数据和 Codex Router 运行日志。")}
        </p>
      </div>
      <SettingsSection
        title={t("界面外观")}
        description={t("更改会立即保存，并同步到其他管理页面。")}
        icon={PaletteIcon}
      >
        <FieldGroup className="gap-0">
          <Field
            orientation="responsive"
            className="py-4 @md/field-group:items-center!"
          >
            <FieldContent>
              <FieldTitle>{t("主题")}</FieldTitle>
              <FieldDescription>
                {t("选择适合当前环境的显示方式。")}
              </FieldDescription>
            </FieldContent>
            <Tabs
              value={theme}
              className="shrink-0"
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark")
                  void onThemeChange(value)
              }}
            >
              <TabsList aria-label={t("主题")}>
                {themeItems.map(({ value, label, icon: Icon }) => (
                  <TabsTab key={value} value={value}>
                    <Icon aria-hidden="true" data-icon="inline-start" />
                    {t(label)}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </Field>
          <Separator />
          <Field
            orientation="responsive"
            className="py-4 @md/field-group:items-center!"
          >
            <FieldContent>
              <FieldTitle>{t("语言")}</FieldTitle>
              <FieldDescription>
                {t("选择管理界面的显示语言。")}
              </FieldDescription>
            </FieldContent>
            <Select
              value={language}
              items={[
                { value: "zh-CN", label: t("简体中文") },
                { value: "en", label: "English" },
              ]}
              onValueChange={(next) => {
                if (next === "zh-CN" || next === "en")
                  void i18n.changeLanguage(next)
              }}
            >
              <SelectTrigger className="w-40 shrink-0" aria-label={t("语言")}>
                <SelectValue />
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
      </SettingsSection>
      <SettingsSection
        title={t("日志记录")}
        description={t(
          "控制安全诊断元数据和 Codex Router 运行日志的详细程度。"
        )}
        icon={TerminalIcon}
      >
        <FieldGroup className="gap-0" aria-busy={saving}>
          <Field
            orientation="horizontal"
            className="items-center! py-4"
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
          <Separator />
          <Field
            orientation="responsive"
            className="py-4 @md/field-group:items-center!"
            data-disabled={saving || undefined}
          >
            <FieldContent>
              <FieldTitle>{t("运行日志等级")}</FieldTitle>
              <FieldDescription>
                {t("调整后立即应用并在重启后保留。")}
              </FieldDescription>
            </FieldContent>
            <Tabs
              value={snapshot.settings.logLevel}
              className="shrink-0"
              onValueChange={(value) => {
                if (
                  value === "debug" ||
                  value === "info" ||
                  value === "warn" ||
                  value === "error"
                )
                  void save({ logLevel: value })
              }}
            >
              <TabsList aria-label={t("运行日志等级")}>
                {["debug", "info", "warn", "error"].map((level) => (
                  <TabsTab key={level} value={level} disabled={saving}>
                    {level.toUpperCase()}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </Field>
        </FieldGroup>
      </SettingsSection>
      <SettingsSection
        title={t("本地环境")}
        description={t(
          "打开 Codex Router 项目页面，或点击本地目录复制完整路径。"
        )}
        icon={DatabaseIcon}
      >
        <div className="flex items-center justify-between gap-3 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <PackageIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <span>{t("Codex Router 版本")}</span>
            <span className="font-medium tabular-nums">
              {snapshot.health.version}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            role="link"
            aria-label={t("Codex Router 版本")}
            render={
              <a
                href="https://github.com/Aurora0201/codex-router"
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            <ExternalLinkIcon aria-hidden="true" />
          </Button>
        </div>
        <Separator />
        <dl className="divide-y divide-border">
          <DirectoryRow
            title={t("数据目录")}
            path={snapshot.health.dataDir}
            icon={DatabaseIcon}
            onCopy={() => void copyPath(snapshot.health.dataDir)}
          />
          <DirectoryRow
            title={t("Codex 配置备份")}
            path={backupDirectory}
            icon={FileArchiveIcon}
            onCopy={() => void copyPath(backupDirectory)}
          />
          <DirectoryRow
            title={t("Codex Router 运行日志")}
            path={logDirectory ?? t("标准输出模式，没有独立日志目录")}
            icon={FileTextIcon}
            disabled={!logDirectory}
            onCopy={() => {
              if (logDirectory) void copyPath(logDirectory)
            }}
          />
        </dl>
      </SettingsSection>
    </section>
  )
}
