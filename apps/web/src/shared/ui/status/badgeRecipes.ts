/**
 * Compact local labels (classification, feature, change, count) share one size and radius with
 * the small rank badge so that every badge of a kind reads with the same weight. Status that
 * reports progress or outcome uses StatusBadge instead.
 */
export const compactBadgeClass =
  "inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border px-2 text-xs/4 font-plain";

export type CompactBadgeTone =
  | "attention"
  | "danger"
  | "neutral"
  | "progress"
  | "success"
  | "warning";

/** Uses the same tone strengths as notices, status badges, toasts, and controls. */
export const compactBadgeToneClass = {
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
} as const satisfies Record<CompactBadgeTone, string>;
