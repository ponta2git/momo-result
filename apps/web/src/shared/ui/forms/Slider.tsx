import { Slider as BaseSlider } from "@base-ui/react/slider";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export type SliderMark = Readonly<{ value: number; label: string }>;

export type SliderProps = {
  id?: string | undefined;
  "aria-label": string;
  "aria-describedby"?: string | undefined;
  /** The exact current value. It is shown as given, never snapped to a step. */
  value: number;
  /** Visual range. It may extend past the settable values so an exact value stays visible. */
  min: number;
  max: number;
  valueText: string;
  marks?: readonly SliderMark[] | undefined;
  startLabel?: ReactNode;
  endLabel?: ReactNode;
  disabled?: boolean | undefined;
  /** The consumer decides the next legal value for arrows (1) and Page keys (large). */
  onStep: (direction: -1 | 1, large: boolean) => void;
  /** Home and End: the consumer decides the settable ends. */
  onBoundary: (edge: "min" | "max") => void;
  /** A raw pointer value; the consumer maps it to a legal value or keeps the current one. */
  onDrag: (value: number) => void;
  /**
   * One drag, track press, or key hold is one operation: `onGestureStart` and `onGestureEnd` are
   * called once each. Escape and pointer cancel end it with `canceled: true`; values that arrive
   * after a cancel are discarded until the next operation starts.
   */
  onGestureStart: () => void;
  onGestureEnd: (outcome: { canceled: boolean }) => void;
};

const stepKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"]);
const edgeKeys = new Set(["Home", "End"]);

/**
 * A single-value slider over Base UI Slider. Base UI owns pointer capture, the hidden range input
 * and its labelling; this primitive owns the operation's lifetime and leaves every value decision
 * to the consumer, so an exact value between steps is never rounded by display, focus, or a
 * press that does not move. Touch drags only from the thumb: a touch on the track scrolls the
 * page instead of jumping the value.
 */
export function Slider({
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  value,
  min,
  max,
  valueText,
  marks = [],
  startLabel,
  endLabel,
  disabled = false,
  onStep,
  onBoundary,
  onDrag,
  onGestureStart,
  onGestureEnd,
}: SliderProps) {
  const span = max > min ? max - min : 1;
  const upper = max > min ? max : min + span;
  const active = useRef<"pointer" | "keyboard" | null>(null);
  const discard = useRef(false);
  const touch = useRef<{ onThumb: boolean } | null>(null);
  const latestEnd = useRef(onGestureEnd);
  useLayoutEffect(() => {
    latestEnd.current = onGestureEnd;
  });

  const start = (kind: "pointer" | "keyboard") => {
    discard.current = false;
    if (active.current) return;
    active.current = kind;
    onGestureStart();
  };
  const end = (canceled: boolean) => {
    if (!active.current) return;
    active.current = null;
    if (canceled) discard.current = true;
    onGestureEnd({ canceled });
  };
  // An operation never outlives the control, so nothing waits for its end.
  useEffect(
    () => () => {
      if (active.current) {
        active.current = null;
        latestEnd.current({ canceled: false });
      }
    },
    [],
  );

  const percent = (mark: number) => `${Math.min(100, Math.max(0, ((mark - min) / span) * 100))}%`;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "Escape") {
      if (active.current) {
        event.preventDefault();
        end(true);
      }
      return;
    }
    if (!stepKeys.has(event.key) && !edgeKeys.has(event.key)) return;
    // Base UI would snap to its step first; every key is decided by the consumer instead.
    event.preventDefault();
    start("keyboard");
    if (discard.current) return;
    if (edgeKeys.has(event.key)) onBoundary(event.key === "Home" ? "min" : "max");
    else
      onStep(
        ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 1,
        event.key === "PageUp" || event.key === "PageDown",
      );
  };

  return (
    <div className="grid min-w-0 gap-0.5">
      {marks.length > 0 ? (
        <div className="relative h-4 px-2" aria-hidden="true">
          <div className="relative h-full">
            {marks.map((mark) => (
              <span
                key={mark.label}
                className={cn(
                  contentText.supporting,
                  "absolute -translate-x-1/2 whitespace-nowrap",
                )}
                style={{ left: percent(mark.value) }}
              >
                {mark.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <BaseSlider.Root
        value={Math.min(upper, Math.max(min, value))}
        min={min}
        max={upper}
        // Fine enough for any four-decimal value; the consumer decides the real steps.
        step={0.0001}
        disabled={disabled}
        thumbAlignment="center"
        onValueChange={(next, details) => {
          const fromTouch = touch.current !== null;
          if (
            discard.current ||
            (fromTouch && !touch.current?.onThumb) ||
            (details.reason === "track-press" && touch.current?.onThumb)
          ) {
            details.cancel();
            return;
          }
          if (details.reason === "input-change") {
            // Assistive technology steps through the hidden input; follow the same rule.
            details.cancel();
            if (next === value) return;
            start("keyboard");
            onStep(next < value ? -1 : 1, false);
            end(false);
            return;
          }
          if (details.reason === "drag" || details.reason === "track-press") onDrag(next);
        }}
        onTouchStartCapture={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          touch.current = { onThumb: Boolean(target?.closest("[data-slider-thumb]")) };
        }}
        onTouchEndCapture={() => {
          touch.current = null;
        }}
        onTouchCancelCapture={() => {
          touch.current = null;
        }}
        onPointerDownCapture={(event) => {
          if (disabled || !event.isPrimary || event.button > 0) return;
          start("pointer");
        }}
        onPointerUpCapture={() => end(false)}
        onPointerCancelCapture={() => end(true)}
        onLostPointerCaptureCapture={() => {
          if (active.current === "pointer") end(false);
        }}
        className="min-w-0"
      >
        <BaseSlider.Control className="relative flex min-h-11 w-full touch-pan-y items-center px-2 data-disabled:opacity-60 pointer-fine:min-h-8">
          <BaseSlider.Track className="relative h-1.5 w-full rounded-full bg-border forced-colors:border forced-colors:border-[CanvasText]">
            <BaseSlider.Indicator className="rounded-full bg-action forced-colors:bg-[Highlight]" />
            {marks.map((mark) => (
              <span
                key={mark.label}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-secondary forced-colors:bg-[CanvasText]"
                style={{ left: percent(mark.value) }}
              />
            ))}
            <BaseSlider.Thumb
              data-slider-thumb=""
              id={id}
              aria-label={ariaLabel}
              aria-describedby={ariaDescribedBy}
              getAriaValueText={() => valueText}
              onKeyDown={onKeyDown}
              onKeyUp={(event) => {
                if (stepKeys.has(event.key) || edgeKeys.has(event.key)) end(false);
              }}
              onBlur={() => end(false)}
              className="size-4 touch-none rounded-full border-2 border-action bg-surface outline-offset-2 before:absolute before:-inset-3.5 before:content-[''] has-focus-visible:outline-2 has-focus-visible:outline-action forced-colors:border-[CanvasText] pointer-fine:before:-inset-1"
            />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
      {startLabel || endLabel ? (
        <div className={cn(contentText.supporting, "flex justify-between tabular-nums")}>
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
