import { useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";

import { useChartInspection } from "@/features/seriesComparison/outlook/workspace/chart/ChartInspection";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

/**
 * Makes a graph readable at any number of games without changing anything it shows: a mouse
 * reads where it points, touch and pen read on tap or horizontal drag, and the keyboard steps
 * through the range. Vertical touch movement stays page scrolling (pan-y); when the browser
 * takes it over, the position before the touch comes back.
 */
export function ChartScrubber({
  range,
  plot,
  label,
  valueText,
  children,
}: {
  range: number;
  /** The plot's horizontal bounds in CSS pixels, relative to this element. */
  plot: Readonly<{ left: number; right: number }>;
  label: string;
  /** The values a reader would see at `h`, read when the position changes. */
  valueText: (h: number) => string;
  children: ReactNode;
}) {
  const { h, set } = useChartInspection();
  // A press is recreated on every pointerdown, so a lost pointerup cannot lock the graph.
  const press = useRef<{ pointerId: number; before: number | null } | null>(null);
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - plot.left) / Math.max(1, plot.right - plot.left);
    return Math.max(0, Math.min(range, Math.round(ratio * range)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = h ?? range;
    const step = event.key === "PageUp" || event.key === "PageDown" ? 10 : 1;
    let next: number | null = null;
    if (["ArrowRight", "ArrowUp", "PageUp"].includes(event.key)) next = current + step;
    if (["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key)) next = current - step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = range;
    if (event.key === "Escape") {
      if (h !== null) event.preventDefault();
      set(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    set(Math.max(0, Math.min(range, next)));
  };
  const shown = h ?? range;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={range}
      aria-valuenow={shown}
      aria-valuetext={valueText(shown)}
      className="relative touch-pan-y rounded-xs select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (h === null) set(range);
      }}
      onBlur={() => set(null)}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button > 0) return;
        press.current = { pointerId: event.pointerId, before: h };
        set(position(event));
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse" || press.current?.pointerId === event.pointerId)
          set(position(event));
      }}
      onPointerUp={() => {
        press.current = null;
      }}
      onPointerCancel={() => {
        const current = press.current;
        press.current = null;
        if (current) set(current.before);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !press.current) set(null);
      }}
    >
      {children}
    </div>
  );
}

/** The values at the read-out position, beside its line; the slider announces the same text. */
export function ChartReadout({
  x,
  width,
  children,
}: {
  x: number;
  width: number;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-6 z-(--z-tooltip) grid min-w-44 gap-0.5 rounded-sm border border-border bg-surface px-3 py-2 shadow-raised tabular-nums",
        contentText.supporting,
      )}
      style={x > width / 2 ? { right: width - x + 10 } : { left: x + 10 }}
    >
      {children}
    </div>
  );
}
