/**
 * Compact local labels (classification, feature, change, count) share one size and radius with
 * the small rank badge so that every badge of a kind reads with the same weight. Status that
 * reports progress or outcome uses StatusBadge instead.
 */
export const compactBadgeClass =
  "inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border px-2 text-xs/4 font-plain";

export const badgeToneClass = {
  attention: "border-tone-review-border bg-tone-review-surface text-text-primary",
  danger: "border-tone-danger-border bg-tone-danger-surface text-text-primary",
  neutral: "border-border bg-surface-subtle text-text-secondary",
  progress: "border-tone-info-border bg-tone-info-surface text-text-primary",
  success: "border-tone-success-border bg-tone-success-surface text-text-primary",
  warning: "border-tone-warning-border bg-tone-warning-surface text-text-primary",
} as const;
