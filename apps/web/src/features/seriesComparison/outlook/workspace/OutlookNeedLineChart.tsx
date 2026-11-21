import { useId, useLayoutEffect, useRef, useState } from "react";

import {
  distributionMean,
  rationalToNumber,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import {
  needLineCrossing,
  needLinePoints,
  needLineScale,
  needLineThreshold,
} from "@/features/seriesComparison/outlook/workspace/needLine";
import { orderFixedMembers } from "@/shared/domain/members";
import { memberSequencePresentation } from "@/shared/matches/MemberSequenceLabel";

type Props = {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  cumulative: CumulativePair;
  focus: RankDistribution;
  rival: RankDistribution;
  range: number;
  goal: { horizon: number; label: string } | null;
  crossingLabel: string | null;
  ariaLabel: string;
};

const mean = (distribution: RankDistribution) => rationalToNumber(distributionMean(distribution));

/**
 * Both questions on one plot: where a kept-up mean meets the need line, and how high the line is
 * at the goal. The two means are named in the right margin, as in the difference chart beside it;
 * the need line and the two regions are named inside the plot (the right corners are always on the
 * correct side).
 */
export function OutlookNeedLineChart({
  names,
  memberIds,
  cumulative,
  focus,
  rival,
  range,
  goal,
  crossingLabel,
  ariaLabel,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [width, setWidth] = useState(640);
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

  const focusMean = mean(focus);
  const rivalMean = mean(rival);
  const goalShown = goal && goal.horizon <= range ? goal : null;
  const edge = needLineThreshold(cumulative, rivalMean, range);
  const scale = needLineScale([
    focusMean,
    rivalMean,
    edge,
    ...(goalShown ? [needLineThreshold(cumulative, rivalMean, goalShown.horizon)] : []),
  ]);
  const height = width < 480 ? 210 : 240;
  const left = 46;
  const right = width - (width < 420 ? 108 : 120);
  const top = 22;
  const bottom = height - 40;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (value: number) =>
    top + ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);
  const clamp = (value: number) => Math.min(scale.max + 1, Math.max(scale.min - 1, value));
  const points = needLinePoints(cumulative, rivalMean, range);
  const curve = points
    .map(
      ([h, value], index) => `${index ? "L" : "M"}${x(h).toFixed(1)},${y(clamp(value)).toFixed(1)}`,
    )
    .join(" ");
  const first = points[0];
  const region = `M${x(0)},${y(scale.min - 1)} L${x(0)},${y(clamp(first?.[1] ?? edge))} ${curve.replace(/^M/u, "L")} L${x(range)},${y(scale.min - 1)} Z`;

  // Line style follows the canonical order, as in the other charts: the second is dashed.
  const canonical = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const style = (role: OutlookRole) => ({
    color: memberSequencePresentation(memberIds[role]).color,
    dash: canonical[1]?.role === role ? "6 4" : undefined,
  });

  const crossing = needLineCrossing(cumulative, focusMean, rivalMean);
  const crossingShown = crossing !== null && crossing <= range ? crossing : null;
  const goalValue = goalShown ? needLineThreshold(cumulative, rivalMean, goalShown.horizon) : null;

  // Labels follow their line's end in the margin and are only pushed apart.
  const lineValues = [focusMean, rivalMean] as const;
  const ends = ([0, 1] as const)
    .map((role) => ({
      role,
      text: `${names[role]} ${outlookAverage(distributionMean(role === 0 ? focus : rival))}`,
      lineY: y(lineValues[role]),
      y: y(lineValues[role]) + 4,
    }))
    .toSorted((a, b) => a.y - b.y);
  const [upperEnd, lowerEnd] = ends;
  if (upperEnd && lowerEnd && lowerEnd.y < upperEnd.y + 14) {
    const middle = (upperEnd.y + lowerEnd.y) / 2;
    upperEnd.y = middle - 7;
    lowerEnd.y = middle + 7;
  }

  // Name the need line where its label clears the plot edges, the two mean lines, the region
  // names and the vertical markers; the line itself is monotone, so its ends bound the span.
  const lineLabel = (() => {
    const labelWidth = 64;
    const avoidX = [goalShown?.horizon, crossingShown ?? undefined]
      .filter((h): h is number => h !== undefined)
      .map(x);
    const blocked = (labelTop: number, labelBottom: number, from: number) =>
      labelTop < top + 16 ||
      labelBottom > bottom - 16 ||
      from + labelWidth > right - 4 ||
      lineValues.some(
        (value) =>
          Math.abs(y(value) - (labelTop + labelBottom) / 2) < (labelBottom - labelTop) / 2 + 3,
      ) ||
      avoidX.some((markerX) => markerX > from - 4 && markerX < from + labelWidth + 4);
    for (const fraction of [0.3, 0.42, 0.55, 0.2, 0.68]) {
      const h = Math.max(1, Math.round(range * fraction));
      const from = x(h) + 4;
      const endH = Math.min(range, h + ((labelWidth + 4) / (right - left)) * range);
      const ys = [
        y(clamp(needLineThreshold(cumulative, rivalMean, h))),
        y(clamp(needLineThreshold(cumulative, rivalMean, endH))),
      ];
      const above = Math.min(...ys) - 6;
      if (!blocked(above - 12, above + 3, from)) return { x: from, y: above };
      const below = Math.max(...ys) + 16;
      if (!blocked(below - 12, below + 3, from)) return { x: from, y: below };
    }
    return null;
  })();

  const topLabels: Array<{ key: string; h: number; text: string }> = [];
  if (goalShown) topLabels.push({ key: "goal", h: goalShown.horizon, text: goalShown.label });
  if (crossingShown !== null && crossingLabel) {
    const near = goalShown && Math.abs(x(goalShown.horizon) - x(crossingShown)) < 84;
    if (!near) topLabels.push({ key: "crossing", h: crossingShown, text: crossingLabel });
  }

  return (
    <div ref={root} className="min-w-0">
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block w-full"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={Math.max(0, right - left)} height={bottom - top} />
          </clipPath>
        </defs>
        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border)" />
            <text
              x={left - 7}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize="12"
              fill="var(--color-text-secondary)"
            >
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
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
          <path d={region} fill={style(0).color} fillOpacity="0.09" />
          <path d={curve} fill="none" stroke="var(--color-text-primary)" strokeWidth="2" />
          {([1, 0] as const).map((role) => (
            <line
              key={role}
              x1={x(0)}
              x2={x(range)}
              y1={y(lineValues[role])}
              y2={y(lineValues[role])}
              stroke={style(role).color}
              strokeWidth="2.5"
              strokeDasharray={style(role).dash}
            />
          ))}
        </g>
        {lineLabel ? (
          <text
            x={lineLabel.x}
            y={lineLabel.y}
            fontSize="12"
            fill="var(--color-text-primary)"
            paintOrder="stroke"
            stroke="var(--color-surface)"
            strokeWidth="3"
          >
            必要な平均
          </text>
        ) : null}
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
        {goalShown && goalValue !== null ? (
          <g>
            <line
              x1={x(goalShown.horizon)}
              x2={x(goalShown.horizon)}
              y1={top}
              y2={bottom}
              stroke="var(--color-text-secondary)"
              strokeOpacity="0.6"
            />
            {goalValue >= scale.min && goalValue <= scale.max ? (
              <circle
                cx={x(goalShown.horizon)}
                cy={y(goalValue)}
                r="4.5"
                fill="var(--color-text-primary)"
                stroke="var(--color-surface)"
                strokeWidth="2"
              />
            ) : null}
          </g>
        ) : null}
        {crossingShown !== null ? (
          <g>
            {topLabels.some((label) => label.key === "crossing") ? (
              <line
                x1={x(crossingShown)}
                x2={x(crossingShown)}
                y1={top}
                y2={y(focusMean)}
                stroke="var(--color-text-secondary)"
                strokeDasharray="2 3"
              />
            ) : null}
            <circle
              cx={x(crossingShown)}
              cy={y(focusMean)}
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
      </svg>
    </div>
  );
}
