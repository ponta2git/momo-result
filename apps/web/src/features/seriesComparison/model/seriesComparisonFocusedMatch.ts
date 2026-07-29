import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import type { MatchPlayerPoint } from "./seriesComparisonPresentationTypes";

export type FocusedMatchRankTransition = {
  nextRank: number;
  previousRank: number;
};

export type FocusedMatchMetricContext = {
  matchId: string | undefined;
  matchIndex: number | undefined;
  pointsByMember: ReadonlyMap<string, MatchPlayerPoint>;
  rankTransitionsByMember: ReadonlyMap<string, FocusedMatchRankTransition>;
  revenueTopMemberIds: ReadonlySet<string>;
};

export function buildFocusedMatchMetricContext(
  response: SeriesComparisonResponse,
  focusMatchId: string | undefined,
): FocusedMatchMetricContext {
  if (!focusMatchId) {
    return emptyFocusedMatchMetricContext();
  }

  const focusedPoints = (response.matchPlayerPoints ?? []).filter(
    (point) => point.matchId === focusMatchId,
  );
  if (focusedPoints.length === 0) {
    return emptyFocusedMatchMetricContext();
  }

  const pointsByMember = new Map(focusedPoints.map((point) => [point.memberId, point]));
  const highestRevenue = Math.max(...focusedPoints.map((point) => point.revenue));
  const revenueTopMemberIds = new Set(
    focusedPoints
      .filter((point) => point.revenue === highestRevenue)
      .map((point) => point.memberId),
  );
  const rankTransitionsByMember = new Map<string, FocusedMatchRankTransition>();

  for (const point of focusedPoints) {
    const previousPoint = (response.matchPlayerPoints ?? [])
      .filter(
        (candidate) =>
          candidate.memberId === point.memberId && candidate.matchIndex < point.matchIndex,
      )
      .toSorted((left, right) => right.matchIndex - left.matchIndex)[0];
    if (previousPoint) {
      rankTransitionsByMember.set(point.memberId, {
        nextRank: point.rank,
        previousRank: previousPoint.rank,
      });
    }
  }

  return {
    matchId: focusMatchId,
    matchIndex: focusedPoints[0]?.matchIndex,
    pointsByMember,
    rankTransitionsByMember,
    revenueTopMemberIds,
  };
}

function emptyFocusedMatchMetricContext(): FocusedMatchMetricContext {
  return {
    matchId: undefined,
    matchIndex: undefined,
    pointsByMember: new Map(),
    rankTransitionsByMember: new Map(),
    revenueTopMemberIds: new Set(),
  };
}
