import { useMemo } from "react";

import { numberTicks } from "@/features/seriesComparison/charts/dataViz/scales";
import {
  buildJointDistribution,
  formatRational,
  generateOutlookExamples,
  jointFromCounts,
  projectOutlook,
  rational,
  rationalToNumber,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  OutlookExample,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  OutlookChartPattern,
  OutlookChartPoint,
  OutlookChartSelection,
} from "@/features/seriesComparison/outlook/OutlookChart";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds } from "@/shared/domain/members";

export function signedOutlookGap(gap: Rational) {
  const absolute = rational(gap.numerator < 0n ? -gap.numerator : gap.numerator, gap.denominator);
  return `${gap.numerator > 0n ? "+" : gap.numerator < 0n ? "−" : "±"}${formatRational(absolute, 2)}`;
}

function averageSelection(
  cumulative: CumulativePair,
  focus: RankDistribution,
  rival: RankDistribution,
  h: number,
): OutlookChartSelection {
  const projected = projectOutlook(cumulative, focus, rival, h);
  return {
    averages: [rationalToNumber(projected.focusAverage), rationalToNumber(projected.rivalAverage)],
    formatted: [
      formatRational(projected.focusAverage, 2),
      formatRational(projected.rivalAverage, 2),
    ],
    relation: projected.relation,
    gapText: signedOutlookGap(projected.gap),
  };
}

function exampleSelection(
  cumulative: CumulativePair,
  example: OutlookExample,
  horizon: number,
): OutlookChartSelection {
  let focus = BigInt(cumulative.focusRankSum);
  let rival = BigInt(cumulative.rivalRankSum);
  for (const [first, second] of example.ranks.slice(0, horizon)) {
    focus += BigInt(first);
    rival += BigInt(second);
  }
  const count = BigInt(cumulative.games) + BigInt(horizon);
  return {
    averages: [Number(focus) / Number(count), Number(rival) / Number(count)],
    formatted: [
      formatRational(rational(focus, count), 2),
      formatRational(rational(rival, count), 2),
    ],
    relation: focus < rival ? "ahead" : focus > rival ? "behind" : "tied",
    gapText: signedOutlookGap(rational(rival - focus, count)),
  };
}

export type OutlookPatternModel = {
  examples: ReturnType<typeof generateOutlookExamples> | null | undefined;
  /** The mean pattern first, then the examples in favourable order for the focus member. */
  patterns: OutlookChartPattern[];
  /** The endpoint difference that ordered each example, in the same order as its pattern. */
  endpointGaps: string[];
  hasTiedExamples: boolean;
  ticks: number[];
  current: OutlookChartSelection;
  averageMarker: { h: number; label: string; averages: readonly [number, number] } | null;
};

/** Mean line, three examples, and one shared axis, computed only while the result is shown. */
export function useOutlookPatterns({
  active,
  response,
  cumulative,
  view,
  memberIds,
  marker,
  exampleLabel,
}: {
  active: boolean;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  view: OutlookResultView;
  memberIds: readonly [string, string];
  marker: { h: number; label: string } | null;
  exampleLabel?: (index: number, tied: boolean) => string;
}): OutlookPatternModel {
  const focus = view.originFocus;
  const rival = view.originRival;
  const liveFocus = view.focus;
  const liveRival = view.rival;
  const range = view.chartRange;
  const examples = useMemo(() => {
    if (!active) return undefined;
    const record = response.recent.jointRanks.find(
      (pair) => memberIds.includes(pair.memberAId) && memberIds.includes(pair.memberBId),
    );
    if (!record) return null;
    const canonicalIds = canonicalResultMemberIds.filter((id) => memberIds.includes(id)) as [
      string,
      string,
    ];
    const focusFirst = canonicalIds[0] === memberIds[0];
    const observed =
      record.memberAId === canonicalIds[0]
        ? record.rankCounts
        : [0, 1, 2, 3].map((column) =>
            record.rankCounts.map((row) => {
              const value = row[column];
              if (value === undefined) throw new Error("Incomplete joint ranks");
              return value;
            }),
          );
    const joint = buildJointDistribution(
      focusFirst ? focus : rival,
      focusFirst ? rival : focus,
      jointFromCounts(observed),
    );
    return joint
      ? generateOutlookExamples({
          gameTitleId: response.artifact.gameTitleId,
          canonicalMemberIds: canonicalIds,
          focusMemberId: memberIds[0],
          cumulative,
          joint,
          selectionRange: range,
        })
      : null;
  }, [active, response, memberIds, focus, rival, cumulative, range]);

  const meanPoints = useMemo<OutlookChartPoint[]>(() => {
    if (!active) return [];
    return Array.from({ length: range + 1 }, (_, h) => ({
      h,
      averages: averageSelection(cumulative, liveFocus, liveRival, h).averages,
    }));
  }, [active, cumulative, liveFocus, liveRival, range]);
  const exampleSeries = useMemo(
    () =>
      examples?.examples
        .map((example) => {
          // Ranks are [focus, rival]; a positive sum means the focus member gained places.
          const difference = example.ranks
            .slice(0, range)
            .reduce((sum, [first, second]) => sum + second - first, 0);
          return {
            example,
            difference,
            endpointGap: signedOutlookGap(
              rational(
                BigInt(cumulative.rivalRankSum - cumulative.focusRankSum + difference),
                BigInt(cumulative.games + range),
              ),
            ),
            points: example.points.map((point): OutlookChartPoint => ({
              h: point.games,
              averages: [point.focusAverage, point.rivalAverage],
            })),
          };
        })
        .toSorted((a, b) => b.difference - a.difference) ?? [],
    [examples, range, cumulative],
  );
  const hasTiedExamples = exampleSeries.some(
    (series, index) => index > 0 && series.difference === exampleSeries[index - 1]?.difference,
  );
  const ticks = useMemo(() => {
    if (!active) return [];
    const bounds = meanPoints.flatMap((point) => [...point.averages]);
    for (const { points } of exampleSeries) {
      for (const point of points) if (point.h <= range) bounds.push(...point.averages);
    }
    // Keep the gesture's starting mean in view while the live mean changes.
    bounds.push(...averageSelection(cumulative, focus, rival, range).averages);
    const low = Math.min(...bounds);
    const high = Math.max(...bounds);
    const padding = (high - low) * 0.08 || 0.01;
    const result = numberTicks(
      Math.max(1, low - padding),
      Math.min(4, high + padding),
      6,
      0.0001,
    ).filter((tick) => tick >= 1 && tick <= 4);
    if (result[0] !== undefined && result[0] > low) result.unshift(1);
    const last = result.at(-1);
    if (last !== undefined && last < high) result.push(4);
    return result;
  }, [active, cumulative, focus, rival, meanPoints, exampleSeries, range]);
  const patterns = useMemo<OutlookChartPattern[]>(() => {
    if (!active) return [];
    return [
      {
        id: "average",
        label: "平均",
        points: meanPoints,
        selected: averageSelection(cumulative, liveFocus, liveRival, view.horizon),
      },
      ...exampleSeries.map(({ example, points }, index): OutlookChartPattern => ({
        id: `example-${index}`,
        label: exampleLabel
          ? exampleLabel(index, hasTiedExamples)
          : hasTiedExamples
            ? `展開例${index + 1}`
            : index === 0
              ? "有利な例"
              : index === 1
                ? "中間の例"
                : "不利な例",
        points,
        selected: exampleSelection(cumulative, example, view.horizon),
      })),
    ];
  }, [
    active,
    cumulative,
    liveFocus,
    liveRival,
    view.horizon,
    meanPoints,
    exampleSeries,
    hasTiedExamples,
    exampleLabel,
  ]);
  const markerHorizon = marker?.h;
  const markerLabel = marker?.label;
  const averageMarker = useMemo(
    () =>
      active && markerHorizon !== undefined && markerLabel !== undefined
        ? {
            h: markerHorizon,
            label: markerLabel,
            averages: averageSelection(cumulative, liveFocus, liveRival, markerHorizon).averages,
          }
        : null,
    [active, cumulative, liveFocus, liveRival, markerHorizon, markerLabel],
  );
  const current = useMemo(
    () => averageSelection(cumulative, liveFocus, liveRival, 0),
    [cumulative, liveFocus, liveRival],
  );
  return {
    examples,
    patterns,
    endpointGaps: exampleSeries.map((series) => series.endpointGap),
    hasTiedExamples,
    ticks,
    current,
    averageMarker,
  };
}
