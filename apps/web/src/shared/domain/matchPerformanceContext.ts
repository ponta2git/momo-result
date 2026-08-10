import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";

type MatchPerformanceTrend = "declined" | "firstMatch" | "improved" | "unchanged" | "unavailable";

export type MatchPerformanceContextRow = {
  cumulativeAverageAfter?: number | undefined;
  cumulativeAverageBefore?: number | undefined;
  cumulativeAverageDelta?: number | undefined;
  memberId: string;
  rank: number;
  revenueAssetRate?: number | undefined;
  revenueManYen: number;
  revenueRank?: number | undefined;
  totalAssetsManYen: number;
  trend: MatchPerformanceTrend;
};

type MatchPerformanceContext = {
  matchIndex?: number | undefined;
  rows: MatchPerformanceContextRow[];
};

export function matchPerformanceContextFromArtifact(
  context: SeriesAnalysisMatchContextV2 | undefined,
): MatchPerformanceContext | undefined {
  if (context?.inclusion.status !== "included" || !context.match) return undefined;
  return {
    matchIndex: context.match.matchIndex,
    rows: context.match.players.map((player) => ({
      cumulativeAverageAfter: player.cumulativeAverageAfter,
      cumulativeAverageBefore: player.cumulativeAverageBefore ?? undefined,
      cumulativeAverageDelta: player.cumulativeAverageDelta ?? undefined,
      memberId: player.memberId,
      rank: player.rank,
      revenueAssetRate: player.revenueAssetRate ?? undefined,
      revenueManYen: player.revenueManYen,
      revenueRank: player.revenueRank,
      totalAssetsManYen: player.totalAssetsManYen,
      trend: performanceTrendFromArtifact(player.cumulativeAverageDirection),
    })),
  };
}

function performanceTrendFromArtifact(
  direction: NonNullable<
    SeriesAnalysisMatchContextV2["match"]
  >["players"][number]["cumulativeAverageDirection"],
): MatchPerformanceTrend {
  if (direction === "first_observation") return "firstMatch";
  if (direction === "improved" || direction === "declined" || direction === "unchanged") {
    return direction;
  }
  return "unavailable";
}
