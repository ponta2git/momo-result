import { useId, useLayoutEffect, useRef, useState } from "react";

import {
  distributionMean,
  distributionsEqual,
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

export type OutlookPreview = { role: OutlookRole; distribution: RankDistribution } | null;

type Props = {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  cumulative: CumulativePair;
  focus: RankDistribution;
  rival: RankDistribution;
  baseline: readonly [RankDistribution, RankDistribution] | undefined;
  preview: OutlookPreview;
  range: number;
  goal: { horizon: number; label: string } | null;
  crossingLabel: string | null;
  ariaLabel: string;
};

const mean = (distribution: RankDistribution) => rationalToNumber(distributionMean(distribution));

/** Both questions on one plot: where a kept-up mean meets the line, and how high it is at the goal. */
export function OutlookNeedLineChart({
  names,
  memberIds,
  cumulative,
  focus,
  rival,
  baseline,
  preview,
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
  const baselineFocus =
    baseline && !distributionsEqual(baseline[0], focus) ? mean(baseline[0]) : null;
  const baselineRival =
    baseline && !distributionsEqual(baseline[1], rival) ? mean(baseline[1]) : null;
  const previewFocus = preview?.role === 0 ? mean(preview.distribution) : null;
  const previewRival = preview?.role === 1 ? mean(preview.distribution) : null;
  const goalShown = goal && goal.horizon <= range ? goal : null;

  const scale = needLineScale([
    focusMean,
    rivalMean,
    needLineThreshold(cumulative, rivalMean, range),
    ...(goalShown ? [needLineThreshold(cumulative, rivalMean, goalShown.horizon)] : []),
    ...[baselineFocus, baselineRival, previewFocus, previewRival].filter(
      (value): value is number => value !== null,
    ),
  ]);
  const height = width < 480 ? 210 : 240;
  const left = 44;
  const right = width - 12;
  const top = 22;
  const bottom = height - 40;
  const x = (h: number) => left + (h / range) * (right - left);
  const y = (value: number) =>
    top + ((value - scale.min) / (scale.max - scale.min)) * (bottom - top);
  const clamp = (value: number) => Math.min(scale.max + 1, Math.max(scale.min - 1, value));
  const curve = (rivalValue: number) =>
    needLinePoints(cumulative, rivalValue, range)
      .map(
        ([h, value], index) =>
          `${index ? "L" : "M"}${x(h).toFixed(1)},${y(clamp(value)).toFixed(1)}`,
      )
      .join(" ");
  const firstH = 0.25;
  const region = `M${x(0)},${y(scale.min - 1)} L${x(0)},${y(clamp(needLineThreshold(cumulative, rivalMean, firstH)))} ${curve(rivalMean).replace(/^M/u, "L")} L${x(range)},${y(scale.min - 1)} Z`;

  // Line style follows the canonical order, as in the trajectory charts: the second is dashed.
  const canonical = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const style = (role: OutlookRole) => ({
    color: memberSequencePresentation(memberIds[role]).color,
    dash: canonical[1]?.role === role ? "6 4" : undefined,
  });

  const crossing = needLineCrossing(cumulative, focusMean, rivalMean);
  const crossingShown = crossing !== null && crossing <= range ? crossing : null;
  const baselineCrossing =
    baselineFocus !== null && baselineRival === null
      ? needLineCrossing(cumulative, baselineFocus, rivalMean)
      : null;
  const previewCrossing =
    previewFocus !== null ? needLineCrossing(cumulative, previewFocus, rivalMean) : null;
  const goalValue = goalShown ? needLineThreshold(cumulative, rivalMean, goalShown.horizon) : null;

  // Name each line at its right end. Two close lines take opposite sides (upper above, lower
  // below); otherwise each label sits on the side away from the need line.
  const edge = needLineThreshold(cumulative, rivalMean, range);
  const lineValues = [focusMean, rivalMean] as const;
  const close = Math.abs(y(focusMean) - y(rivalMean)) < 30;
  const lineLabels = ([0, 1] as const).map((role) => {
    const value = lineValues[role];
    const other = lineValues[role === 0 ? 1 : 0];
    const below = close ? value > other || (value === other && role === 1) : value >= edge;
    return {
      role,
      text: `${names[role]} ${outlookAverage(distributionMean(role === 0 ? focus : rival))}`,
      y: y(value) + (below ? 15 : -6),
    };
  });
  for (const label of lineLabels) label.y = Math.min(bottom - 3, Math.max(top + 11, label.y));

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
          {baselineRival !== null ? (
            <path
              d={curve(baselineRival)}
              fill="none"
              stroke="var(--color-text-secondary)"
              strokeOpacity="0.6"
              strokeWidth="1.5"
              strokeDasharray="2 3"
            />
          ) : null}
          {previewRival !== null ? (
            <path
              d={curve(previewRival)}
              fill="none"
              stroke="var(--color-text-primary)"
              strokeOpacity="0.7"
              strokeWidth="1.5"
              strokeDasharray="2 3"
            />
          ) : null}
          <path
            d={curve(rivalMean)}
            fill="none"
            stroke="var(--color-text-primary)"
            strokeWidth="2"
          />
          {(
            [
              ["rival", 1, rivalMean, 1, undefined],
              ["baseline", 0, baselineFocus, 0.5, "2 3"],
              ["preview", 0, previewFocus, 0.8, "2 3"],
              ["focus", 0, focusMean, 1, undefined],
            ] as const
          ).map(([key, role, value, opacity, dash]) =>
            value === null ? null : (
              <line
                key={key}
                x1={x(0)}
                x2={x(range)}
                y1={y(value)}
                y2={y(value)}
                stroke={style(role).color}
                strokeOpacity={opacity}
                strokeWidth={dash ? 2 : 2.5}
                strokeDasharray={dash ?? style(role).dash}
              />
            ),
          )}
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
        {(
          [
            ["baseline", baselineCrossing, baselineFocus],
            ["preview", previewCrossing, previewFocus],
          ] as const
        ).map(([key, h, value]) =>
          h === null || value === null || h > range ? null : (
            <circle
              key={key}
              cx={x(h)}
              cy={y(value)}
              r="4.5"
              fill="var(--color-surface)"
              stroke={style(0).color}
              strokeWidth="2"
            />
          ),
        )}
        {lineLabels.map((label) => (
          <text
            key={label.role}
            x={right - 4}
            y={label.y}
            textAnchor="end"
            fontSize="12"
            fill="var(--color-text-primary)"
            stroke="var(--color-surface)"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
