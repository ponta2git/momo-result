import { memo, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type Point = { h: number; gap: number };

/** One gap axis keeps changes to either player's assumptions mapped to the same result. */
export const OutlookChart = memo(function OutlookChart({
  points,
  recent,
  examples,
  horizon,
  marker,
  markerLabel,
  focusName,
  rivalName,
  gesturing,
  sameLine,
  recentCount,
  exampleStatus,
}: {
  points: Point[];
  recent: Point[];
  examples: number[][];
  horizon: number;
  marker: number | null;
  markerLabel: string;
  focusName: string;
  rivalName: string;
  gesturing: boolean;
  sameLine: boolean;
  recentCount: number;
  exampleStatus?: string | undefined;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const titleId = useId();
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = [
    ...points.map((point) => point.gap),
    ...recent.map((point) => point.gap),
    ...examples.flat(),
    0,
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.15, 0.005);
  const desired = { min: low - padding, max: high + padding };
  const [axis, setAxis] = useState(desired);
  const min = gesturing ? Math.min(axis.min, desired.min) : desired.min;
  const max = gesturing ? Math.max(axis.max, desired.max) : desired.max;
  if (axis.min !== min || axis.max !== max) setAxis({ min, max });
  const left = 48,
    right = width - 16,
    top = 38,
    bottom = 226;
  const x = (h: number) => left + (h / 100) * (right - left);
  const y = (gap: number) => bottom - ((gap - min) / (max - min)) * (bottom - top);
  const path = (data: Point[]) =>
    data.map((point, i) => `${i ? "L" : "M"}${x(point.h)},${y(point.gap)}`).join(" ");
  const marks = [max, 0, min];
  const shownMarker = marker !== null && marker >= 0 && marker <= 100 ? marker : null;
  const markerPoint = shownMarker === null ? undefined : points[shownMarker];
  return (
    <figure className="grid min-w-0 gap-2" aria-labelledby={titleId}>
      <figcaption className="grid gap-1" id={titleId}>
        <span className={contentText.heading}>総合平均順位の差</span>
        <span className={contentText.supporting}>
          上は{focusName}、下は{rivalName}が先行
        </span>
      </figcaption>
      <div ref={root} className="relative min-w-0">
        <svg
          height={270}
          viewBox={`0 0 ${width} 270`}
          className="block w-full"
          role="img"
          aria-label={`この先100戦の平均順位の差。${markerLabel}`}
        >
          {marks.map((value, index) => (
            <g key={index}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                stroke={index === 1 ? "var(--color-border-strong)" : "var(--color-border)"}
              />
              <text
                x={left - 7}
                y={y(value) + 4}
                textAnchor="end"
                fontSize="12"
                fill="var(--color-text-secondary)"
              >
                {value === 0 ? "同率" : value.toFixed(3)}
              </text>
            </g>
          ))}
          {[0, 20, 50, 100].map((h) => (
            <text
              key={h}
              x={x(h)}
              y={bottom + 20}
              textAnchor="middle"
              fontSize="12"
              fill="var(--color-text-secondary)"
            >
              {h}
            </text>
          ))}
          <text
            x={(left + right) / 2}
            y={262}
            textAnchor="middle"
            fontSize="12"
            fill="var(--color-text-secondary)"
          >
            この先の試合数（0は現在）
          </text>
          {[50, 100, ...(horizon <= 100 && horizon !== 50 && horizon !== 100 ? [horizon] : [])].map(
            (h) => (
              <line
                key={h}
                aria-label={`${h}戦後の目安`}
                x1={x(h)}
                x2={x(h)}
                y1={top}
                y2={bottom}
                stroke="var(--color-border-strong)"
                strokeDasharray="2 4"
              />
            ),
          )}
          {examples.map((gaps, index) => (
            <path
              key={index}
              d={path(gaps.map((gap, h) => ({ h, gap })))}
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeWidth="1.25"
              opacity=".5"
              strokeDasharray={index === 0 ? "2 3" : index === 1 ? "6 3" : undefined}
            />
          ))}
          {!sameLine ? (
            <path
              d={path(recent)}
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          ) : null}
          <path
            d={path(points)}
            fill="none"
            stroke="var(--color-analysis-emphasis)"
            strokeWidth="2.5"
          />
          {shownMarker !== null && markerPoint ? (
            <g>
              <line
                x1={x(shownMarker)}
                x2={x(shownMarker)}
                y1={24}
                y2={y(markerPoint.gap)}
                stroke="var(--color-analysis-emphasis)"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(shownMarker)}
                cy={y(markerPoint.gap)}
                r="4"
                fill="var(--color-analysis-emphasis)"
              />
              <text
                x={Math.max(left + 4, Math.min(right - 4, x(shownMarker)))}
                y={18}
                textAnchor={shownMarker < 25 ? "start" : shownMarker > 75 ? "end" : "middle"}
                fontSize="12"
                fill="var(--color-text-primary)"
              >
                {shownMarker}戦で{markerPoint.gap === 0 ? "同率" : "同率以上"}
              </text>
            </g>
          ) : null}
        </svg>
        {exampleStatus ? (
          <p
            role="status"
            className={cn(
              contentText.supporting,
              "pointer-events-none absolute top-5 right-4 left-12",
            )}
          >
            {exampleStatus}
          </p>
        ) : null}
      </div>
      <div className={cn(contentText.supporting, "flex flex-wrap gap-x-4 gap-y-1")}>
        <span>実線：指定した成績</span>
        <span>
          {sameLine ? `直近${recentCount}戦と同じ推移` : `破線：直近${recentCount}戦のまま`}
        </span>
      </div>
    </figure>
  );
});
