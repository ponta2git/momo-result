import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";

export type StatusBadgeTone =
  | "attention"
  | "danger"
  | "neutral"
  | "progress"
  | "success"
  | "warning";

const toneClass = {
  attention:
    "border-[var(--color-tone-review-border)] bg-[var(--color-tone-review-surface)] text-[var(--color-text-primary)]",
  danger:
    "border-[var(--color-tone-danger-border)] bg-[var(--color-tone-danger-surface)] text-[var(--color-text-primary)]",
  neutral:
    "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
  progress:
    "border-[var(--color-tone-info-border)] bg-[var(--color-tone-info-surface)] text-[var(--color-text-primary)]",
  success:
    "border-[var(--color-tone-success-border)] bg-[var(--color-tone-success-surface)] text-[var(--color-text-primary)]",
  warning:
    "border-[var(--color-tone-warning-border)] bg-[var(--color-tone-warning-surface)] text-[var(--color-text-primary)]",
} as const satisfies Record<StatusBadgeTone, string>;

export type StatusBadgeProps = {
  /** Opts a persistent, dynamically changing badge into a polite atomic live region. */
  announceChanges?: boolean | undefined;
  busy?: boolean | undefined;
  hideIcon?: boolean | undefined;
  icon?: ReactNode | undefined;
  label: ReactNode;
  note?: ReactNode | undefined;
  tone?: StatusBadgeTone | undefined;
};

/** A domain-free visual status primitive; feature adapters own status labels and mapping. */
export function StatusBadge({
  announceChanges = false,
  busy = false,
  hideIcon = false,
  icon,
  label,
  note,
  tone = "neutral",
}: StatusBadgeProps) {
  const statusIcon = busy ? <SpinnerIcon /> : icon;

  return (
    <span
      aria-atomic={announceChanges || undefined}
      // The label is already complete. aria-busy on its live region would defer
      // announcing a pending status until the work had finished.
      aria-busy={busy && !announceChanges ? true : undefined}
      aria-live={announceChanges ? "polite" : undefined}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-xs border px-2 py-1 text-xs font-plain leading-5",
        toneClass[tone],
      )}
      role={announceChanges ? "status" : undefined}
    >
      {!hideIcon && statusIcon ? (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center [&_svg]:size-4"
        >
          {statusIcon}
        </span>
      ) : null}
      <span>{label}</span>
      {note ? <span className="text-[var(--color-text-secondary)]">{note}</span> : null}
    </span>
  );
}
