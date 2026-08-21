import { useState } from "react";
import { format } from "date-fns";
import { CalendarDaysIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AccountView } from "@/services/contracts";

function fromTimestamp(value: number | null): Date | undefined {
  if (value === null) return undefined;
  const date = new Date(value);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toTimestamp(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function SubscriptionDateDialog({
  account,
  busy,
  onOpenChange,
  onSave,
}: {
  account: AccountView;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onSave(value: number | null): void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState<Date | undefined>(() =>
    fromTimestamp(account.subscription.expiresAt ?? account.subscriptionExpiresAt)
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("设置订阅到期日")}</DialogTitle>
          <DialogDescription>
            {t("订阅到期日由你手工维护，仅用于提醒，不会自动阻断路由。")}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("订阅到期日")}</FieldLabel>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    data-empty={!date}
                    className="justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                  />
                }
              >
                <CalendarDaysIcon />
                {date ? format(date, "yyyy-MM-dd") : t("选择日期")}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(value) => {
                    setDate(value);
                    if (value) setPickerOpen(false);
                  }}
                  captionLayout="dropdown"
                />
              </PopoverContent>
            </Popover>
            <FieldDescription>
              {account.subscription.source === "legacy_estimate"
                ? t("这是由旧订阅开始日推算的日期，请确认后保存。")
                : date
                  ? t("到期提醒日期：{{date}}", { date: format(date, "yyyy-MM-dd") })
                  : t("尚未设置订阅到期日")}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          {account.subscription.expiresAt !== null || account.subscriptionExpiresAt !== null ? (
            <Button variant="ghost" disabled={busy} onClick={() => onSave(null)}>
              {t("清除日期")}
            </Button>
          ) : null}
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {t("取消")}
          </DialogClose>
          <Button disabled={!date || busy} onClick={() => date && onSave(toTimestamp(date))}>
            {t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
