import { useMemo } from "react"
import { useTranslation } from "react-i18next"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { FieldGroup } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

type AccountOption = { value: string; label: string }

export function FilterSelect({
  value,
  onChange,
  label,
  items,
  className,
}: {
  value: string
  onChange(value: string): void
  label: string
  items: { value: string; label: string }[]
  className?: string
}) {
  const selectedLabel =
    items.find((item) => item.value === value)?.label ?? items[0]?.label
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className={cn("w-36", className)} aria-label={label}>
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** One question per group, so the popover reads as a form and not a wall. */
export function FilterGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs text-muted-foreground-subtle">{title}</h4>
      <FieldGroup className="grid gap-3 sm:grid-cols-2">{children}</FieldGroup>
    </section>
  )
}

export function AccountCombobox({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountView[]
  value?: string
  onChange(value?: string): void
}) {
  const { t } = useTranslation()
  const options = useMemo<AccountOption[]>(
    () => [
      { value: "all", label: t("全部账号") },
      { value: "__client_passthrough__", label: t("Codex 默认账号") },
      ...accounts.map((account) => ({
        value: account.id,
        label: account.email ?? account.chatgptAccountId ?? account.id,
      })),
    ],
    [accounts, t]
  )
  const selected =
    options.find((option) => option.value === (value ?? "all")) ?? options[0]
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) =>
        onChange(option?.value === "all" ? undefined : option?.value)
      }
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
    >
      <ComboboxInput
        className="w-full"
        placeholder={t("搜索账号邮箱")}
        aria-label={t("账号筛选")}
      />
      <ComboboxContent className="min-w-80">
        <ComboboxEmpty>{t("没有匹配的账号")}</ComboboxEmpty>
        <ComboboxList>
          {(option: AccountOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
