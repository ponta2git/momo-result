/**
 * Every chart, matrix, and card marks the selected match with the same ring and the same visible
 * label, so the marker never relies on color or on a chart-specific shape.
 */
export const focusedMetricRingClass =
  "ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface)]";
export const focusedMetricLabelClass = "font-plain text-xs text-[var(--color-action)]";

/** Parts-of-a-whole bars share one outline wherever they appear. */
export const compositionBarClass =
  "flex h-4 overflow-hidden rounded-xs bg-[var(--color-surface-subtle)]";
export const compositionSegmentSeparator = "inset 1px 0 var(--color-chart-segment-separator)";
