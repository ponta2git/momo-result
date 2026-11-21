import { useId } from "react";

import { useChartWidth } from "@/features/seriesComparison/charts/dataViz/useChartWidth";
import {
  distributionMean,
  rationalToNumber,
  requiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import { outlookRequirementText } from "@/features/seriesComparison/outlook/outlookAnswers";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import {
  ChartGamesAxis,
  ChartYAxis,
} from "@/features/seriesComparison/outlook/workspace/chart/ChartAxes";
import { useChartInspection } from "@/features/seriesComparison/outlook/workspace/chart/ChartInspection";
import {
  layoutEndLabels,
  placeInlineLabel,
} from "@/features/seriesComparison/outlook/workspace/chart/chartLabels";
import type { ChartBox } from "@/features/seriesComparison/outlook/workspace/chart/chartLabels";
import {
  ChartReadout,
  ChartScrubber,
} from "@/features/seriesComparison/outlook/workspace/chart/ChartScrubber";
import {
  needLinePoints,
  needLineScale,
  needLineThreshold,
} from "@/features/seriesComparison/outlook/workspace/needLine";
import { orderFixedMembers } from "@/shared/domain/members";
import { memberSequencePresentation } from "@/shared/matches/MemberSequenceLabel";
import { contentText } from "@/shared/ui/typography";

const LINE_LABEL = "必要な平均";
const LINE_LABEL_WIDTH = 64;

/**
 * Both questions on one plot: where a kept-up mean meets the need line, and how high the line is
 * at the goal. The two means are named in the right margin, as in the difference graph beside
 * it; the need line and the two regions are named inside the plot (the right corners are always
 * on the correct side of the line).
 */
export function OutlookNeedLineChart({
  names,
  memberIds,
  cumulative,
  pair,
  origin,
  range,
  goalHorizon,
  marker,
  ariaLabel,
}: {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  cumulative: CumulativePair;
  pair: readonly [RankDistribution, RankDistribution];
  /** The means at the start of a gesture, kept inside the vertical axis while dragging. */
  origin: readonly [RankDistribution, RankDistribution];
  range: number;
  goalHorizon: number;
  /** The trend answer's integer game, so both graphs mark the same moment. */
  marker: Readonly<{ h: number; label: string }> | null;
  ariaLabel: string;
}) {
  const { containerRef, width } = useChartWidth(1, 4000);
  const clipId = useId();
  const { h: inspect } = useChartInspection();
  const means = [
    rationalToNumber(distributionMean(pair[0])),
    rationalToNumber(distributionMean(pair[1])),
  ] as const;
  const rivalMean = means[1];
  const goalShown = goalHorizon <= range ? goalHorizon : null;
  const edge = needLineThreshold(cumulative, rivalMean, range);
  const scale = needLineScale([
    ...means,
    rationalToNumber(distributionMean(origin[0])),
    rationalToNumber(distributionMean(origin[1])),
    edge,
    ...(goalShown ? [needLineThreshold(cumulative, rivalMean, goalShown)] : []),
  ]);
  const height = width < 480 ? 210 : 230;
  const left = 46;
  const right = Math.max(left + 1, width - (width < 420 ? 108 : 120));
  const top = 22;
  const bottom = height - 40;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (value: number) =>
    top + ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);
  const clamp = (value: number) => Math.min(scale.max + 1, Math.max(scale.min - 1, value));
  const at = (h: number) => y(clamp(needLineThreshold(cumulative, rivalMean, h)));
  const points = needLinePoints(cumulative, rivalMean, range);
  const curve = points
    .map(
      ([h, value], index) => `${index ? "L" : "M"}${x(h).toFixed(1)},${y(clamp(value)).toFixed(1)}`,
    )
    .join(" ");
  const firstValue = points[0]?.[1] ?? edge;
  const region = `M${x(0)},${y(scale.min - 1)} L${x(0)},${y(clamp(firstValue))} ${curve.replace(/^M/u, "L")} L${x(range)},${y(scale.min - 1)} Z`;

  // Line style follows the canonical order, as in the other analysis graphs: the second is dashed.
  const canonical = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const style = (role: OutlookRole) => ({
    color: memberSequencePresentation(memberIds[role]).color,
    dash: canonical[1]?.role === role ? "6 4" : undefined,
  });

  const ends = layoutEndLabels(
    ([0, 1] as const).map((role) => ({
      role,
      text: `${names[role]} ${outlookAverage(distributionMean(pair[role]))}`,
      lineY: y(means[role]),
      anchorY: y(means[role]) + 4,
    })),
    { gap: 14, top: top + 8, bottom: bottom + 4 },
  );

  const markerShown = marker && marker.h <= range ? marker : null;
  const topLabels: Array<{ key: string; h: number; text: string }> = [];
  if (goalShown) topLabels.push({ key: "goal", h: goalShown, text: "目標" });
  if (markerShown && !(goalShown && Math.abs(x(goalShown) - x(markerShown.h)) < 84))
    topLabels.push({ key: "marker", h: markerShown.h, text: markerShown.label });

  // Name the need line where its label clears the plot edges, both mean lines, the region names
  // and the vertical markers. The line is monotone, so its ends bound the label's span.
  const obstacles: ChartBox[] = [
    ...means.map((mean) => ({ x0: left, x1: right, y0: y(mean) - 3, y1: y(mean) + 3 })),
    { x0: right - 80, x1: right, y0: top, y1: top + 20 },
    { x0: right - 80, x1: right, y0: bottom - 20, y1: bottom },
    ...[goalShown, markerShown?.h]
      .filter((h): h is number => h !== null && h !== undefined)
      .map((h) => ({ x0: x(h) - 4, x1: x(h) + 4, y0: top, y1: bottom })),
  ];
  const candidates = [0.3, 0.42, 0.55, 0.2, 0.68].flatMap((fraction) => {
    const h = Math.max(1, Math.round(range * fraction));
    const x0 = x(h) + 4;
    const endH = Math.min(range, h + ((LINE_LABEL_WIDTH + 4) / (right - left)) * range);
    const spanTop = Math.min(at(h), at(endH));
    const spanBottom = Math.max(at(h), at(endH));
    return [
      { x0, x1: x0 + LINE_LABEL_WIDTH, y0: spanTop - 18, y1: spanTop - 3 },
      { x0, x1: x0 + LINE_LABEL_WIDTH, y0: spanBottom + 3, y1: spanBottom + 18 },
    ];
  });
  const lineLabel = placeInlineLabel(candidates, obstacles, {
    x0: left,
    x1: right,
    y0: top,
    y1: bottom,
  });

  const readoutAt = (h: number) =>
    h === 0
      ? "今の時点では比べられません"
      : `${names[0]}が上回るのに必要な平均 ${outlookRequirementText(requiredMean(cumulative, pair[1], h), names[1])}`;

  return (
    <div ref={containerRef} className="min-w-0">
      <ChartScrubber
        range={range}
        plot={{ left, right }}
        label={`${ariaLabel} 矢印キーで戦数を選ぶと、その時点の必要な平均を読めます。`}
        valueText={(h) => `${h}戦後。${readoutAt(h)}`}
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
          <ChartYAxis
            ticks={scale.ticks}
            y={y}
            left={left}
            right={right}
            format={(tick) => tick.toFixed(2)}
          />
          <ChartGamesAxis
            range={range}
            x={x}
            left={left}
            right={right}
            bottom={bottom}
            height={height}
          />
          <g clipPath={`url(#${clipId})`}>
            <path d={region} fill={style(0).color} fillOpacity="0.09" />
            <path d={curve} fill="none" stroke="var(--color-text-primary)" strokeWidth="2" />
            {([1, 0] as const).map((role) => (
              <line
                key={role}
                x1={x(0)}
                x2={x(range)}
                y1={y(means[role])}
                y2={y(means[role])}
                stroke={style(role).color}
                strokeWidth="2.5"
                strokeDasharray={style(role).dash}
              />
            ))}
          </g>
          <g fontSize="12" fill="var(--color-text-secondary)">
            {y(edge) - top >= 24 ? (
              <text x={right - 6} y={top + 15} textAnchor="end">
                {names[0]}が上
              </text>
            ) : null}
            {bottom - y(edge) >= 24 ? (
              <text x={right - 6} y={bottom - 7} textAnchor="end">
                {names[1]}が上
              </text>
            ) : null}
          </g>
          {lineLabel ? (
            <text
              x={lineLabel.x0}
              y={lineLabel.y1 - 3}
              fontSize="12"
              fill="var(--color-text-primary)"
              paintOrder="stroke"
              stroke="var(--color-surface)"
              strokeWidth="3"
            >
              {LINE_LABEL}
            </text>
          ) : null}
          {topLabels.map((label) => {
            const lx = x(label.h);
            return (
              <text
                key={label.key}
                x={Math.min(right, Math.max(left, lx))}
                y={14}
                textAnchor={lx > right - 60 ? "end" : lx < left + 60 ? "start" : "middle"}
                fontSize="12"
                fill="var(--color-text-primary)"
              >
                {label.text}
              </text>
            );
          })}
          {goalShown ? (
            <g>
              <line
                x1={x(goalShown)}
                x2={x(goalShown)}
                y1={top}
                y2={bottom}
                stroke="var(--color-text-secondary)"
                strokeOpacity="0.6"
              />
              <circle
                cx={x(goalShown)}
                cy={at(goalShown)}
                r="4.5"
                fill="var(--color-text-primary)"
                stroke="var(--color-surface)"
                strokeWidth="2"
              />
            </g>
          ) : null}
          {markerShown ? (
            <g>
              {topLabels.some((label) => label.key === "marker") ? (
                <line
                  x1={x(markerShown.h)}
                  x2={x(markerShown.h)}
                  y1={top}
                  y2={y(means[0])}
                  stroke="var(--color-text-secondary)"
                  strokeDasharray="2 3"
                />
              ) : null}
              <circle
                cx={x(markerShown.h)}
                cy={y(means[0])}
                r="5"
                fill={style(0).color}
                stroke="var(--color-surface)"
                strokeWidth="2"
              />
            </g>
          ) : null}
          {ends.map((end) => (
            <g key={end.role}>
              <line
                x1={right}
                x2={right + 4}
                y1={end.lineY}
                y2={end.y - 4}
                stroke="var(--color-border-strong)"
              />
              <text x={right + 7} y={end.y} fontSize="12" fill="var(--color-text-primary)">
                {end.text}
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
              {inspect > 0 ? (
                <circle
                  cx={x(inspect)}
                  cy={at(inspect)}
                  r="4"
                  fill="var(--color-text-primary)"
                  stroke="var(--color-surface)"
                  strokeWidth="1.5"
                />
              ) : null}
            </g>
          ) : null}
        </svg>
        {inspect !== null ? (
          <ChartReadout x={x(inspect)} width={width}>
            <span className={contentText.heading}>{inspect}戦後</span>
            <span className="text-text-primary">{readoutAt(inspect)}</span>
          </ChartReadout>
        ) : null}
      </ChartScrubber>
    </div>
  );
}
