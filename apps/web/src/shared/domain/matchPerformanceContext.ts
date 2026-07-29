import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

type MatchPlayerPoint = NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number];

export type MatchPerformanceInput = {
  memberId: string;
  rank: number;
  revenueManYen: number;
  totalAssetsManYen: number;
};

export type MatchPerformanceTrend =
  | "declined"
  | "firstMatch"
  | "improved"
  | "unchanged"
  | "unavailable";

export type MatchPerformanceContextRow = MatchPerformanceInput & {
  cumulativeAverageAfter?: number | undefined;
  cumulativeAverageBefore?: number | undefined;
  cumulativeAverageDelta?: number | undefined;
  revenueAssetRate?: number | undefined;
  revenueRank: number;
  trend: MatchPerformanceTrend;
};

export type MatchPerformanceContext = {
  matchIndex?: number | undefined;
  rows: MatchPerformanceContextRow[];
  targetIncluded: boolean;
};

export function buildMatchPerformanceContext({
  currentResults,
  matchId,
  matchPlayerPoints = [],
}: {
  currentResults: MatchPerformanceInput[];
  matchId: string;
  matchPlayerPoints?: MatchPlayerPoint[] | undefined;
}): MatchPerformanceContext {
  const targetPoints = matchPlayerPoints.filter((point) => point.matchId === matchId);
  const matchIndex = targetPoints[0]?.matchIndex;

  return {
    matchIndex,
    rows: currentResults.map((result) => {
      const targetPoint = targetPoints.find((point) => point.memberId === result.memberId);
      const historyBefore =
        targetPoint === undefined
          ? []
          : matchPlayerPoints
              .filter(
                (point) =>
                  point.memberId === result.memberId && point.matchIndex < targetPoint.matchIndex,
              )
              .toSorted((left, right) => left.matchIndex - right.matchIndex);
      const cumulativeAverageBefore =
        historyBefore.length === 0 ? undefined : average(historyBefore.map((point) => point.rank));
      const cumulativeAverageAfter =
        targetPoint === undefined
          ? undefined
          : average([...historyBefore.map((point) => point.rank), targetPoint.rank]);
      const cumulativeAverageDelta =
        cumulativeAverageBefore === undefined || cumulativeAverageAfter === undefined
          ? undefined
          : cumulativeAverageAfter - cumulativeAverageBefore;

      return {
        ...result,
        cumulativeAverageAfter,
        cumulativeAverageBefore,
        cumulativeAverageDelta,
        revenueAssetRate:
          result.totalAssetsManYen > 0
            ? result.revenueManYen / result.totalAssetsManYen
            : undefined,
        revenueRank: averageRevenueRank(result.revenueManYen, currentResults),
        trend: performanceTrend({
          cumulativeAverageAfter,
          cumulativeAverageBefore,
          cumulativeAverageDelta,
          targetPoint,
        }),
      };
    }),
    targetIncluded: targetPoints.length > 0,
  };
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageRevenueRank(
  revenueManYen: number,
  currentResults: MatchPerformanceInput[],
): number {
  const betterCount = currentResults.filter(
    (result) => result.revenueManYen > revenueManYen,
  ).length;
  const tiedCount = currentResults.filter(
    (result) => result.revenueManYen === revenueManYen,
  ).length;
  return betterCount + 1 + (tiedCount - 1) / 2;
}

function performanceTrend({
  cumulativeAverageAfter,
  cumulativeAverageBefore,
  cumulativeAverageDelta,
  targetPoint,
}: {
  cumulativeAverageAfter: number | undefined;
  cumulativeAverageBefore: number | undefined;
  cumulativeAverageDelta: number | undefined;
  targetPoint: MatchPlayerPoint | undefined;
}): MatchPerformanceTrend {
  if (targetPoint === undefined || cumulativeAverageAfter === undefined) {
    return "unavailable";
  }
  if (cumulativeAverageBefore === undefined) {
    return "firstMatch";
  }
  if (cumulativeAverageDelta === undefined || Math.abs(cumulativeAverageDelta) < 0.005) {
    return "unchanged";
  }
  return cumulativeAverageDelta < 0 ? "improved" : "declined";
}
