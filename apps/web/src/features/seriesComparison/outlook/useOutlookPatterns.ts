import { useCallback, useMemo } from "react";

import {
  buildJointDistribution,
  drawOutlookExampleCandidates,
  jointFromCounts,
  projectOutlook,
  rational,
  rationalToNumber,
  selectOutlookExamples,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  OutlookExample,
  OutlookExampleCandidates,
  OutlookExamples,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/outlook/calculation";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds } from "@/shared/domain/members";

type Pair = readonly [RankDistribution, RankDistribution];

/** One line of the difference graph: float points for drawing, exact values for every label. */
export type OutlookTrajectory = Readonly<{
  id: string;
  label: string;
  kind: "average" | "example";
  /** Rival average minus focus average after h games; positive means the focus person leads. */
  points: ReadonlyArray<Readonly<{ h: number; gap: number }>>;
  gapAt: (h: number) => Rational;
}>;

export type OutlookTrajectoryStatus =
  | "ready"
  /** No joint ranks for this pair, or no legal joint table for the assumed distributions. */
  | "unavailable"
  /** The example calculation failed; the average line and every answer stay usable. */
  | "failed";

export type OutlookTrajectoryModel = Readonly<{
  status: OutlookTrajectoryStatus;
  /** The average line first, then the examples in favourable order for the focus person. */
  trajectories: readonly OutlookTrajectory[];
  /** Exact example differences at any horizon up to 1000, in the same order as the lines. */
  exampleGapsAt: (h: number) => readonly Rational[];
  tiedExamples: boolean;
  distinctCandidateCount: number | null;
  constantPerGameDifference: boolean;
}>;

/** The exact difference of one drawn example after h games. */
export function outlookExampleGapAt(
  cumulative: CumulativePair,
  example: OutlookExample,
  h: number,
): Rational {
  let difference = BigInt(cumulative.rivalRankSum - cumulative.focusRankSum);
  for (const [focusRank, rivalRank] of example.ranks.slice(0, h))
    difference += BigInt(rivalRank - focusRank);
  return rational(difference, BigInt(cumulative.games + h));
}

/**
 * Orders the examples from favourable to unfavourable for the focus person by their exact
 * difference at the range's end. If any two end equal, all three get neutral names instead of a
 * better-or-worse order the values do not support.
 */
export function orderOutlookExamples(
  examples: readonly OutlookExample[],
  cumulative: CumulativePair,
  range: number,
): Array<OutlookTrajectory & { tied: boolean }> {
  const ordered = examples
    .map((example) => ({ example, end: outlookExampleGapAt(cumulative, example, range) }))
    .toSorted((a, b) => {
      const left = a.end.numerator * b.end.denominator;
      const right = b.end.numerator * a.end.denominator;
      return left === right ? 0 : left > right ? -1 : 1;
    });
  const tied = ordered.some((line, index) => {
    const previous = ordered[index - 1];
    return (
      previous !== undefined &&
      line.end.numerator * previous.end.denominator ===
        previous.end.numerator * line.end.denominator
    );
  });
  const names = ["有利な例", "中間の例", "不利な例"];
  return ordered.map(({ example }, index) => ({
    id: `example-${index}`,
    label: tied ? `展開例${index + 1}` : (names[index] ?? `展開例${index + 1}`),
    kind: "example",
    points: example.points
      .filter((point) => point.games <= range)
      .map((point) => ({ h: point.games, gap: point.gap })),
    gapAt: (h: number) => outlookExampleGapAt(cumulative, example, h),
    tied,
  }));
}

function canonicalPair(memberIds: readonly [string, string]) {
  return canonicalResultMemberIds.filter((id) => memberIds.includes(id)) as [string, string];
}

/** Draws candidates once per title, pair, and assumed joint table; never during a gesture. */
function drawCandidates(
  response: SeriesAnalysisOutlookSummary,
  memberIds: readonly [string, string],
  origin: Pair,
): OutlookExampleCandidates | "unavailable" | "failed" {
  const record = response.recent.jointRanks.find(
    (pair) => memberIds.includes(pair.memberAId) && memberIds.includes(pair.memberBId),
  );
  if (!record) return "unavailable";
  try {
    const canonicalIds = canonicalPair(memberIds);
    const focusFirst = canonicalIds[0] === memberIds[0];
    const observed =
      record.memberAId === canonicalIds[0]
        ? record.rankCounts
        : [0, 1, 2, 3].map((column) =>
            record.rankCounts.map((row) => {
              const value = row[column];
              if (value === undefined) throw new RangeError("Incomplete joint ranks");
              return value;
            }),
          );
    const joint = buildJointDistribution(
      focusFirst ? origin[0] : origin[1],
      focusFirst ? origin[1] : origin[0],
      jointFromCounts(observed),
    );
    if (!joint) return "unavailable";
    return drawOutlookExampleCandidates({
      gameTitleId: response.artifact.gameTitleId,
      canonicalMemberIds: canonicalIds,
      joint,
    });
  } catch {
    return "failed";
  }
}

/**
 * The average line and three examples of the difference, computed only while shown. During a
 * gesture the examples keep the gesture's starting assumptions; a different range reselects from
 * the same candidates.
 */
export function useOutlookPatterns({
  active,
  response,
  cumulative,
  pair,
  origin,
  memberIds,
  range,
}: {
  active: boolean;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  /** The live assumptions, followed by the average line. */
  pair: Pair;
  /** The assumptions at the start of the current gesture, or the live ones. */
  origin: Pair;
  memberIds: readonly [string, string];
  range: 50 | 100 | 200;
}): OutlookTrajectoryModel {
  const [originFocus, originRival] = origin;
  const drawn = useMemo(
    () => (active ? drawCandidates(response, memberIds, [originFocus, originRival]) : undefined),
    [active, response, memberIds, originFocus, originRival],
  );
  const selected = useMemo((): OutlookExamples | "failed" | undefined => {
    if (!drawn || typeof drawn === "string") return undefined;
    try {
      return selectOutlookExamples(drawn, {
        focusMemberId: memberIds[0],
        cumulative,
        selectionRange: range,
      });
    } catch {
      return "failed";
    }
  }, [drawn, memberIds, cumulative, range]);
  const examples = typeof selected === "object" ? selected : undefined;

  const [focus, rival] = pair;
  const average = useMemo((): OutlookTrajectory | undefined => {
    if (!active) return undefined;
    const gapAt = (h: number) => projectOutlook(cumulative, focus, rival, h).gap;
    return {
      id: "average",
      label: "平均どおり",
      kind: "average",
      points: Array.from({ length: range + 1 }, (_, h) => ({
        h,
        gap: rationalToNumber(gapAt(h)),
      })),
      gapAt,
    };
  }, [active, cumulative, focus, rival, range]);

  const exampleLines = useMemo(
    () => (examples ? orderOutlookExamples(examples.examples, cumulative, range) : []),
    [examples, cumulative, range],
  );

  const exampleGapsAt = useCallback(
    (h: number) => exampleLines.map((line) => line.gapAt(h)),
    [exampleLines],
  );
  const status: OutlookTrajectoryStatus =
    drawn === "failed" || selected === "failed"
      ? "failed"
      : drawn === "unavailable"
        ? "unavailable"
        : "ready";
  return {
    status,
    trajectories: average ? [average, ...exampleLines] : [],
    exampleGapsAt,
    tiedExamples: exampleLines.some((line) => line.tied),
    distinctCandidateCount: examples?.distinctCandidateCount ?? null,
    constantPerGameDifference: examples?.constantPerGameDifference ?? false,
  };
}
