import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

type NoticeTone = "info" | "success" | "warning" | "danger";

const toneClass: Record<NoticeTone, string> = {
  info: "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  success:
    "border-[var(--color-success)]/50 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  warning:
    "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/22 text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 text-[var(--color-text-primary)]",
};

export type NoticeProps = {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  role?: "alert" | "note" | "status";
  title?: ReactNode;
  tone?: NoticeTone;
};

export function Notice({ action, children, className, role, title, tone = "info" }: NoticeProps) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border p-3 text-sm leading-6",
        toneClass[tone],
        className,
      )}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      {title ? (
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      ) : null}
      <div className={cn("min-w-0 text-pretty", title ? "mt-1" : "")}>{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
