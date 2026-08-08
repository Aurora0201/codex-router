import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account } from "@/lib/api";
import { shortId } from "@/lib/format";

function selectable(account: Account): boolean {
  return account.enabled && account.authStatus === "ready";
}

export function ActiveAccountSelect({ accounts, activeId, disabled, onSelect }: {
  accounts: Account[];
  activeId: string | null;
  disabled?: boolean;
  onSelect(id: string): void;
}) {
  const active = accounts.find((account) => account.id === activeId);
  return (
    <Select value={activeId ?? undefined} disabled={disabled} onValueChange={onSelect}>
      <SelectTrigger className="w-full font-mono sm:w-[24rem]">
        <SelectValue placeholder="尚未选择当前账号">
          {active
            ? `${shortId(active.chatgptAccountId)}${active.email ? ` · ${active.email}` : ""}${active.planType ? ` · ${active.planType}` : ""}`
            : "尚未选择当前账号"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.filter(selectable).map((account) => (
          <SelectItem key={account.id} value={account.id} className="font-mono">
            {shortId(account.chatgptAccountId)}{account.email ? ` · ${account.email}` : ""}{account.planType ? ` · ${account.planType}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
