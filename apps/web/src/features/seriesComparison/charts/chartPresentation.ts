export const memberChartCardClass =
  "grid min-w-0 content-start gap-2 rounded-md border border-border bg-surface p-4";

/**
 * Every chart, matrix, and card marks the selected match with the same ring and the same visible
 * label, so the marker never relies on color or on a chart-specific shape.
 */
export const focusedMetricRingClass = "ring-2 ring-action ring-offset-1 ring-offset-surface";
export const focusedMetricLabelClass = "font-plain text-xs text-action";

/** Parts-of-a-whole bars share one outline wherever they appear. */
export const compositionBarClass = "flex h-4 overflow-hidden rounded-xs bg-surface-subtle";
export const compositionSegmentSeparator = "inset 1px 0 var(--color-chart-segment-separator)";
