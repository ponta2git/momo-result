import { useRef } from "react";
import type { PointerEvent } from "react";

type Selection = { horizon: number; horizonText: string };
type Drag = {
  pointerId: number;
  x: number;
  y: number;
  direction: "pending" | "horizontal" | "vertical";
  before: Selection;
};

/** The plot chooses 1–100 by position; keyboard input also reaches the numeric range beyond it. */
export function OutlookChartScrubber({
  horizon,
  horizonText,
  valueText,
  descriptionId,
  onChange,
}: Selection & {
  valueText: string;
  descriptionId: string;
  onChange: (selection: Selection) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const select = (value: number) => {
    const next = Math.max(1, Math.min(1000, value));
    onChange({ horizon: next, horizonText: String(next) });
  };
  const selectPosition = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    select(
      Math.max(1, Math.min(100, Math.round(((event.clientX - rect.left) / rect.width) * 100))),
    );
  };
  const cancel = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.direction === "horizontal") onChange(current.before);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="グラフで確認する戦数"
      aria-valuemin={1}
      aria-valuemax={1000}
      aria-valuenow={horizon}
      aria-valuetext={valueText}
      aria-describedby={descriptionId}
      aria-orientation="horizontal"
      data-outlook-preserve-draft
      className="absolute inset-0 cursor-ew-resize touch-pan-y select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || drag.current) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          direction: "pending",
          before: { horizon, horizonText },
        };
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (current.direction === "pending") {
          const dx = Math.abs(event.clientX - current.x);
          const dy = Math.abs(event.clientY - current.y);
          if (Math.max(dx, dy) < 6) return;
          current.direction = dx > dy ? "horizontal" : "vertical";
        }
        if (current.direction === "horizontal") selectPosition(event);
      }}
      onPointerUp={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        drag.current = null;
        if (current.direction !== "vertical") selectPosition(event);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) cancel();
      }}
      onBlur={cancel}
      onKeyDown={(event) => {
        let next: number;
        switch (event.key) {
          case "ArrowLeft":
          case "ArrowDown":
            next = horizon - 1;
            break;
          case "ArrowRight":
          case "ArrowUp":
            next = horizon + 1;
            break;
          case "PageDown":
            next = horizon - 10;
            break;
          case "PageUp":
            next = horizon + 10;
            break;
          case "Home":
            next = 1;
            break;
          case "End":
            next = 1000;
            break;
          case "Escape":
            if (drag.current) {
              event.preventDefault();
              cancel();
            }
            return;
          default:
            return;
        }
        event.preventDefault();
        if (drag.current) cancel();
        select(next);
      }}
    />
  );
}
