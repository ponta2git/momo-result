import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { numberTicks } from "@/features/seriesComparison/charts/dataViz/scales";
import type { OutlookChartPattern } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import { memberSequencePresentation } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type Series = {
  id: string;
  label: string;
  primary: boolean;
  /** Overall-average difference seen from the focus member: positive means the focus leads. */
  gaps: ReadonlyArray<readonly [number, number]>;
  points: OutlookChartPattern["points"];
};

const signed = (value: number) => {
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(rounded) < 1e-9
    ? "±0.00"
    : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(2)}`;
};

/**
 * Who leads, by how much, and how much that can swing. One difference line replaces two average
 * lines per pattern: the mean path is bold, the examples are thin, and zero marks a tie.
 */
export function OutlookGapChart({
  names,
  memberIds,
  patterns,
  range,
  crossing,
  ariaLabel,
}: {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  /** The mean pattern first, then up to three examples. */
  patterns: readonly OutlookChartPattern[];
  range: number;
  crossing: { h: number; label: string } | null;
  ariaLabel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const readoutId = useId();
  const [width, setWidth] = useState(560);
  const [inspect, setInspect] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    setWidth(Math.max(1, Math.floor(element.getBoundingClientRect().width)));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const series: Series[] = patterns.map((pattern, index) => {
    const points = pattern.points.filter((point) => point.h <= range);
    return {
      id: pattern.id,
      label: index === 0 ? "平均どおり" : pattern.label,
      primary: index === 0,
      gaps: points.map((point) => [point.h, point.averages[1] - point.averages[0]] as const),
      points,
    };
  });
  const values = series.flatMap((item) => item.gaps.map(([, gap]) => gap));
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const padding = Math.max(0.02, (high - low) * 0.1);
  const ticks = numberTicks(low - padding, high + padding, 6, 0.01);
  const min = ticks[0] ?? low - padding;
  const max = ticks.at(-1) ?? high + padding;

  const labelWidth = width < 420 ? 108 : 120;
  const height = width < 420 ? 210 : 230;
  const left = 46;
  const right = width - labelWidth;
  const top = 22;
  const bottom = height - 40;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (gap: number) => top + ((max - gap) / (max - min)) * (bottom - top);
  const path = (gaps: Series["gaps"]) =>
    gaps
      .map(([h, gap], index) => `${index ? "L" : "M"}${x(h).toFixed(1)},${y(gap).toFixed(1)}`)
      .join(" ");

  // End labels sit beside each line's last point and are pushed apart without crossing.
  const ends = series
    .map((item) => {
      const last = item.gaps.at(-1);
      return last ? { item, value: last[1], y: y(last[1]) + 4 } : null;
    })
    .filter((end): end is NonNullable<typeof end> => end !== null)
    .toSorted((a, b) => a.y - b.y);
  for (let index = 1; index < ends.length; index++) {
    const previous = ends[index - 1];
    const current = ends[index];
    if (previous && current && current.y < previous.y + 14) current.y = previous.y + 14;
  }
  const overflow = (ends.at(-1)?.y ?? 0) - (bottom + 4);
  if (overflow > 0) for (const end of ends) end.y -= overflow;

  const focusColor = memberSequencePresentation(memberIds[0]).color;
  const rivalColor = memberSequencePresentation(memberIds[1]).color;
  const zero = y(0);
  const showCrossing = crossing && crossing.h > 0 && crossing.h <= range ? crossing : null;

  const setFromPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / Math.max(1, box.width);
    setInspect(Math.max(0, Math.min(range, Math.round(ratio * range))));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "PageUp" || event.key === "PageDown" ? 10 : 1;
    const current = inspect ?? range;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp")
      next = current + step;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "PageDown")
      next = current - step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = range;
    if (event.key === "Escape") {
      setInspect(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setInspect(Math.max(0, Math.min(range, next)));
  };
  const readout =
    inspect === null
      ? null
      : series.map((item) => {
          const point = item.points.find((value) => value.h === inspect);
          const gap = item.gaps.find(([h]) => h === inspect)?.[1];
          return { item, point, gap };
        });
  const readoutLeft = inspect === null ? 0 : x(inspect);

  return (
    <div ref={root} className="relative min-w-0">
      <div
        tabIndex={0}
        role="slider"
        aria-label={`${ariaLabel} 矢印キーで戦数を選ぶと、その時点の差を読めます。`}
        aria-valuemin={0}
        aria-valuemax={range}
        aria-valuenow={inspect ?? range}
        aria-valuetext={`${inspect ?? range}戦後`}
        aria-describedby={readout ? readoutId : undefined}
        onKeyDown={onKeyDown}
        onFocus={() => setInspect((value) => value ?? range)}
        onBlur={() => setInspect(null)}
        className="rounded-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block w-full"
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={top} width={Math.max(0, right - left)} height={bottom - top} />
            </clipPath>
          </defs>
          <rect
            x={left}
            y={top}
            width={right - left}
            height={Math.max(0, zero - top)}
            fill={focusColor}
            fillOpacity="0.07"
          />
          <rect
            x={left}
            y={zero}
            width={right - left}
            height={Math.max(0, bottom - zero)}
            fill={rivalColor}
            fillOpacity="0.07"
          />
          {ticks.map((tick) => (
            <g key={tick}>
              {Math.abs(tick) < 1e-9 ? null : (
                <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border)" />
              )}
              <text
                x={left - 7}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize="12"
                fill={
                  Math.abs(tick) < 1e-9
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)"
                }
              >
                {Math.abs(tick) < 1e-9 ? "同率" : signed(tick)}
              </text>
            </g>
          ))}
          <line
            x1={left}
            x2={right}
            y1={zero}
            y2={zero}
            stroke="var(--color-text-primary)"
            strokeOpacity="0.55"
          />
          {zero - top >= 24 ? (
            <text x={left + 8} y={top + 15} fontSize="12" fill="var(--color-text-secondary)">
              {names[0]}が上
            </text>
          ) : null}
          {bottom - zero >= 24 ? (
            <text x={left + 8} y={bottom - 7} fontSize="12" fill="var(--color-text-secondary)">
              {names[1]}が上
            </text>
          ) : null}
          {[0, Math.round(range / 2), range].map((h) => (
            <text
              key={h}
              x={x(h)}
              y={bottom + 18}
              textAnchor={h === 0 ? "start" : h === range ? "end" : "middle"}
              fontSize="12"
              fill="var(--color-text-secondary)"
            >
              {h}
            </text>
          ))}
          <text
            x={(left + right) / 2}
            y={height - 4}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-text-secondary)"
          >
            この先の試合数
          </text>
          <g clipPath={`url(#${clipId})`}>
            {series
              .filter((item) => !item.primary)
              .map((item) => (
                <path
                  key={item.id}
                  d={path(item.gaps)}
                  fill="none"
                  stroke="var(--color-text-secondary)"
                  strokeOpacity="0.55"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              ))}
            {series
              .filter((item) => item.primary)
              .map((item) => (
                <path
                  key={item.id}
                  d={path(item.gaps)}
                  fill="none"
                  stroke="var(--color-text-primary)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                />
              ))}
          </g>
          {showCrossing ? (
            <g>
              <line
                x1={x(showCrossing.h)}
                x2={x(showCrossing.h)}
                y1={top}
                y2={zero}
                stroke="var(--color-text-secondary)"
                strokeDasharray="2 3"
              />
              <circle
                cx={x(showCrossing.h)}
                cy={zero}
                r="5"
                fill="var(--color-surface)"
                stroke="var(--color-text-primary)"
                strokeWidth="2"
              />
              <text
                x={Math.min(right, Math.max(left, x(showCrossing.h)))}
                y={14}
                textAnchor={
                  x(showCrossing.h) > right - 60
                    ? "end"
                    : x(showCrossing.h) < left + 60
                      ? "start"
                      : "middle"
                }
                fontSize="12"
                fill="var(--color-text-primary)"
              >
                {showCrossing.label}
              </text>
            </g>
          ) : null}
          {ends.map((end) => (
            <g key={end.item.id}>
              <line
                x1={right}
                x2={right + 4}
                y1={y(end.value)}
                y2={end.y - 4}
                stroke="var(--color-border-strong)"
              />
              <text
                x={right + 7}
                y={end.y}
                fontSize="12"
                fontWeight={end.item.primary ? 600 : 400}
                fill={
                  end.item.primary ? "var(--color-text-primary)" : "var(--color-text-secondary)"
                }
              >
                {end.item.label} {signed(end.value)}
              </text>
            </g>
          ))}
          {inspect !== null ? (
            <g>
              <line
                x1={x(inspect)}
                x2={x(inspect)}
                y1={top}
                y2={bottom}
                stroke="var(--color-text-primary)"
                strokeOpacity="0.6"
              />
              {series.map((item) => {
                const gap = item.gaps.find(([h]) => h === inspect)?.[1];
                return gap === undefined ? null : (
                  <circle
                    key={item.id}
                    cx={x(inspect)}
                    cy={y(gap)}
                    r={item.primary ? 4 : 3}
                    fill={item.primary ? "var(--color-text-primary)" : "var(--color-surface)"}
                    stroke={item.primary ? "var(--color-surface)" : "var(--color-text-secondary)"}
                    strokeWidth="1.5"
                  />
                );
              })}
            </g>
          ) : null}
          <rect
            x={left}
            y={top}
            width={Math.max(0, right - left)}
            height={bottom - top}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerDown={setFromPointer}
            onPointerMove={(event) => {
              if (event.pointerType === "mouse" || event.buttons > 0) setFromPointer(event);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setInspect(null);
            }}
          />
        </svg>
      </div>
      {readout ? (
        <div
          id={readoutId}
          role="status"
          className={cn(
            "pointer-events-none absolute top-6 z-(--z-tooltip) grid min-w-44 gap-0.5 rounded-sm border border-border bg-surface px-3 py-2 shadow-raised tabular-nums",
            contentText.supporting,
          )}
          style={
            readoutLeft > width / 2
              ? { right: width - readoutLeft + 10 }
              : { left: readoutLeft + 10 }
          }
        >
          <span className={contentText.heading}>{inspect}戦後</span>
          {readout.map(({ item, point, gap }) =>
            gap === undefined ? null : (
              <span key={item.id} className={item.primary ? "text-text-primary" : undefined}>
                {item.label} {signed(gap)}
                {item.primary && point
                  ? `（${names[0]} ${point.averages[0].toFixed(2)}・${names[1]} ${point.averages[1].toFixed(2)}）`
                  : ""}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
