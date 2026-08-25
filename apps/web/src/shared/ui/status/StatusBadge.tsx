import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";

export type StatusBadgeTone =
  | "attention"
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

const toneClass = {
  attention:
    "border-[var(--color-review)]/70 bg-[var(--color-review)]/14 text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-danger)]/55 bg-[var(--color-danger)]/10 text-[var(--color-text-primary)]",
  info: "border-[var(--color-action)]/60 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]",
  neutral:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  success:
    "border-[var(--color-success)]/60 bg-[var(--color-success)]/12 text-[var(--color-text-primary)]",
  warning:
    "border-[var(--color-warning)]/80 bg-[var(--color-warning)]/20 text-[var(--color-text-primary)]",
} as const satisfies Record<StatusBadgeTone, string>;

export type StatusBadgeProps = {
  busy?: boolean | undefined;
  className?: string | undefined;
  hideIcon?: boolean | undefined;
  icon?: ReactNode | undefined;
  label: ReactNode;
  note?: ReactNode | undefined;
  tone?: StatusBadgeTone | undefined;
};

/** A domain-free visual status primitive; feature adapters own status labels and mapping. */
export function StatusBadge({
  busy = false,
  className,
  hideIcon = false,
  icon,
  label,
  note,
  tone = "neutral",
}: StatusBadgeProps) {
  const statusIcon = busy ? (
    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
  ) : (
    icon
  );

  return (
    <span
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius-xs)] border px-2 py-1 text-xs font-semibold leading-5",
        toneClass[tone],
        className,
      )}
    >
      {!hideIcon && statusIcon ? (
        <span aria-hidden="true" className="shrink-0">
          {statusIcon}
        </span>
      ) : null}
      <span>{label}</span>
      {note ? <span className="text-[var(--color-text-secondary)]">{note}</span> : null}
    </span>
  );
}
