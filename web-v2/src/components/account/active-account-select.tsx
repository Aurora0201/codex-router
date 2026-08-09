import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { shortAccountId } from "@/lib/format"
import type { AccountView } from "@/services/contracts"

export function ActiveAccountSelect({
  accounts,
  activeId,
  disabled,
  onValueChange,
}: {
  accounts: AccountView[]
  activeId: string | null
  disabled?: boolean
  onValueChange(value: string | null): void
}) {
  const items = [
    { value: null, label: "不选择账号" },
    ...accounts
      .filter((account) => account.enabled && account.authStatus === "ready")
      .map((account) => ({
        value: account.id,
        label: `${shortAccountId(account.chatgptAccountId)} · ${account.email ?? "无邮箱"}`,
      })),
  ]

  return (
    <Select
      items={items}
      value={activeId}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="w-full sm:w-80" aria-label="当前路由账号">
        <SelectValue />
      </SelectTrigger>
      <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value ?? "none"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
