import { useEffect, useRef, type ButtonHTMLAttributes, type PropsWithChildren, type ReactNode } from "react";
import { cn } from "../lib/utils";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return <button className={cn("inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45", {
    "bg-primary text-primary-foreground hover:brightness-110": variant === "primary",
    "border bg-card-raised hover:bg-muted": variant === "secondary",
    "bg-destructive text-white hover:brightness-110": variant === "danger",
    "text-muted-foreground hover:bg-muted hover:text-foreground": variant === "ghost",
  }, className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card p-5 shadow-[0_14px_40px_rgba(0,0,0,.12)]", className)} {...props} />;
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "good" | "warn" | "bad" | "neutral" }>) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", {
    "border-primary/40 bg-primary/10 text-primary": tone === "good",
    "border-amber-400/40 bg-amber-400/10 text-amber-300": tone === "warn",
    "border-destructive/40 bg-destructive/10 text-destructive": tone === "bad",
    "bg-muted text-muted-foreground": tone === "neutral",
  })}>{children}</span>;
}

export function Dialog({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} className="m-auto w-[min(92vw,32rem)] rounded-xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-[#020b12]/75">
    <div className="border-b p-5"><h2 className="text-lg font-semibold">{title}</h2></div>
    <div className="p-5">{children}</div>
  </dialog>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>;
}
