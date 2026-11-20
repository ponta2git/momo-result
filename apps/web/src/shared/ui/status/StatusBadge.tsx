import type { ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { SpinnerIcon } from "@/shared/ui/feedback/Spinner";
import { badgeToneClass } from "@/shared/ui/status/badgeRecipes";

export type StatusBadgeTone = keyof typeof badgeToneClass;

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
        badgeToneClass[tone],
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
      {note ? <span className="text-text-secondary">{note}</span> : null}
    </span>
  );
}
