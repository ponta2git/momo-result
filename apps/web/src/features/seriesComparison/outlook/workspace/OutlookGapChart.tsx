import { useId } from "react";

import { numberTicks } from "@/features/seriesComparison/charts/dataViz/scales";
import { useChartWidth } from "@/features/seriesComparison/charts/dataViz/useChartWidth";
import { rationalToNumber } from "@/features/seriesComparison/outlook/calculation";
import type { Rational } from "@/features/seriesComparison/outlook/calculation";
import { signedOutlookGap } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookTrajectory } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import {
  ChartGamesAxis,
  ChartYAxis,
} from "@/features/seriesComparison/outlook/workspace/chart/ChartAxes";
import { useChartInspection } from "@/features/seriesComparison/outlook/workspace/chart/ChartInspection";
import { layoutEndLabels } from "@/features/seriesComparison/outlook/workspace/chart/chartLabels";
import {
  ChartReadout,
  ChartScrubber,
} from "@/features/seriesComparison/outlook/workspace/chart/ChartScrubber";
import { memberSequencePresentation } from "@/shared/matches/MemberSequenceLabel";
import { contentText } from "@/shared/ui/typography";

const axisLabel = (tick: number) =>
  Math.abs(tick) < 1e-9 ? "同率" : `${tick > 0 ? "+" : "−"}${Math.abs(tick).toFixed(2)}`;

/**
 * Who leads, by how much, and how much that can swing. One difference line replaces two average
 * lines per pattern: the average is bold, the examples are thin, and zero marks a tie. Every
 * number and sign comes from the exact values; floats only place the marks.
 */
export function OutlookGapChart({
  names,
  memberIds,
  trajectories,
  originAverage,
  range,
  marker,
  averagesAt,
  ariaLabel,
}: {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  /** The average line first, then up to three examples. */
  trajectories: readonly OutlookTrajectory[];
  /** The average line at the start of a gesture, kept inside the vertical axis while dragging. */
  originAverage: readonly number[];
  range: number;
  marker: Readonly<{ h: number; label: string }> | null;
  averagesAt: (h: number) => readonly [Rational, Rational];
  ariaLabel: string;
}) {
  const { containerRef, width } = useChartWidth(1, 4000);
  const clipId = useId();
  const { h: inspect } = useChartInspection();
  const values = [
    0,
    ...originAverage,
    ...trajectories.flatMap((line) => line.points.map((point) => point.gap)),
  ];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(0.02, (high - low) * 0.1);
  const ticks = numberTicks(low - padding, high + padding, 6, 0.01);
  const min = ticks[0] ?? low - padding;
  const max = ticks.at(-1) ?? high + padding;

  const labelWidth = width < 420 ? 108 : 120;
  const height = width < 420 ? 210 : 230;
  const left = 46;
  const right = Math.max(left + 1, width - labelWidth);
  const top = 22;
  const bottom = height - 40;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (gap: number) => top + ((max - gap) / (max - min)) * (bottom - top);
  const path = (line: OutlookTrajectory) =>
    line.points
      .map(
        (point, index) => `${index ? "L" : "M"}${x(point.h).toFixed(1)},${y(point.gap).toFixed(1)}`,
      )
      .join(" ");
  const average = trajectories.find((line) => line.kind === "average");
  const ends = layoutEndLabels(
    trajectories.map((line) => {
      const value = line.gapAt(range);
      return {
        line,
        value,
        lineY: y(rationalToNumber(value)),
        anchorY: y(rationalToNumber(value)) + 4,
      };
    }),
    { gap: 14, top: top + 8, bottom: bottom + 4 },
  );
  const focusColor = memberSequencePresentation(memberIds[0]).color;
  const rivalColor = memberSequencePresentation(memberIds[1]).color;
  const zero = y(0);
  const markerY = marker && average ? y(rationalToNumber(average.gapAt(marker.h))) : zero;

  const readoutAt = (h: number) => {
    const [focusAverage, rivalAverage] = averagesAt(h);
    return trajectories.map((line) => ({
      line,
      text:
        line.kind === "average"
          ? `${line.label} ${signedOutlookGap(line.gapAt(h))}（${names[0]} ${rationalToNumber(focusAverage).toFixed(2)}・${names[1]} ${rationalToNumber(rivalAverage).toFixed(2)}）`
          : `${line.label} ${signedOutlookGap(line.gapAt(h))}`,
    }));
  };

  return (
    <div ref={containerRef} className="min-w-0">
      <ChartScrubber
        range={range}
        plot={{ left, right }}
        label={`${ariaLabel} 矢印キーで戦数を選ぶと、その時点の差を読めます。`}
        valueText={(h) =>
          `${h}戦後。${readoutAt(h)
            .map((item) => item.text)
            .join("、")}`
        }
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
              <rect x={left} y={top} width={right - left} height={bottom - top} />
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
          <ChartYAxis
            ticks={ticks}
            y={y}
            left={left}
            right={right}
            format={axisLabel}
            emphasize={(tick) => Math.abs(tick) < 1e-9}
          />
          <g fontSize="12" fill="var(--color-text-secondary)">
            {zero - top >= 24 ? (
              <text x={left + 8} y={top + 15}>
                {names[0]}が上
              </text>
            ) : null}
            {bottom - zero >= 24 ? (
              <text x={left + 8} y={bottom - 7}>
                {names[1]}が上
              </text>
            ) : null}
          </g>
          <ChartGamesAxis
            range={range}
            x={x}
            left={left}
            right={right}
            bottom={bottom}
            height={height}
          />
          <g clipPath={`url(#${clipId})`}>
            {trajectories
              .filter((line) => line.kind === "example")
              .map((line) => (
                <path
                  key={line.id}
                  d={path(line)}
                  fill="none"
                  stroke="var(--color-text-secondary)"
                  strokeOpacity="0.55"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              ))}
            {average ? (
              <path
                d={path(average)}
                fill="none"
                stroke="var(--color-text-primary)"
                strokeWidth="2.5"
                strokeLinejoin="round"
              />
            ) : null}
          </g>
          {marker ? (
            <g>
              <line
                x1={x(marker.h)}
                x2={x(marker.h)}
                y1={top}
                y2={markerY}
                stroke="var(--color-text-secondary)"
                strokeDasharray="2 3"
              />
              <circle
                cx={x(marker.h)}
                cy={markerY}
                r="5"
                fill="var(--color-surface)"
                stroke="var(--color-text-primary)"
                strokeWidth="2"
              />
              <text
                x={Math.min(right, Math.max(left, x(marker.h)))}
                y={14}
                textAnchor={
                  x(marker.h) > right - 60 ? "end" : x(marker.h) < left + 60 ? "start" : "middle"
                }
                fontSize="12"
                fill="var(--color-text-primary)"
              >
                {marker.label}
              </text>
            </g>
          ) : null}
          {ends.map((end) => (
            <g key={end.line.id}>
              <line
                x1={right}
                x2={right + 4}
                y1={end.lineY}
                y2={end.y - 4}
                stroke="var(--color-border-strong)"
              />
              <text
                x={right + 7}
                y={end.y}
                fontSize="12"
                fontWeight={end.line.kind === "average" ? 600 : 400}
                fill={
                  end.line.kind === "average"
                    ? "var(--color-text-primary)"
                    : "var(--color-text-secondary)"
                }
              >
                {end.line.label} {signedOutlookGap(end.value)}
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
              {trajectories.map((line) => (
                <circle
                  key={line.id}
                  cx={x(inspect)}
                  cy={y(rationalToNumber(line.gapAt(inspect)))}
                  r={line.kind === "average" ? 4 : 3}
                  fill={
                    line.kind === "average" ? "var(--color-text-primary)" : "var(--color-surface)"
                  }
                  stroke={
                    line.kind === "average" ? "var(--color-surface)" : "var(--color-text-secondary)"
                  }
                  strokeWidth="1.5"
                />
              ))}
            </g>
          ) : null}
        </svg>
        {inspect !== null ? (
          <ChartReadout x={x(inspect)} width={width}>
            <span className={contentText.heading}>{inspect}戦後</span>
            {readoutAt(inspect).map((item) => (
              <span
                key={item.line.id}
                className={item.line.kind === "average" ? "text-text-primary" : undefined}
              >
                {item.text}
              </span>
            ))}
          </ChartReadout>
        ) : null}
      </ChartScrubber>
    </div>
  );
}
