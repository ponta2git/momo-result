import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import { isNumber } from "./seriesComparisonFormatters";
import { metricsMap, recentFormMap } from "./seriesComparisonMaps";
import type {
  CardShopDestinationEntry,
  CardShopDestinationQuadrant,
  MatchPlayerPoint,
  PlayOrderHeatmapRow,
  RankDistributionBarEntry,
  RecentRankStripEntry,
  RevenueRankConversionEntry,
} from "./seriesComparisonPresentationTypes";

export function recentRankStrips(response: SeriesComparisonResponse): RecentRankStripEntry[] {
  const recentByMember = recentFormMap(response);
  const pointsByMember = matchPlayerPointsByMember(response);
  return (response.players ?? []).map((player) => {
    const form = recentByMember.get(player.memberId);
    const windowSize = form?.windowSize ?? 8;
    const points = (pointsByMember.get(player.memberId) ?? []).toSorted(pointSort);
    const fallbackTargetCount = Math.min(points.length, windowSize);
    return {
      memberId: player.memberId,
      points: points.map((point) => ({
        matchId: point.matchId,
        matchIndex: point.matchIndex,
        rank: point.rank,
      })),
      status: form?.status ?? statusForTargetCount(fallbackTargetCount),
      targetCount: form?.targetCount ?? fallbackTargetCount,
      totalCount: points.length,
      windowSize,
    };
  });
}

export function rankDistributionBars(
  response: SeriesComparisonResponse,
): RankDistributionBarEntry[] {
  const metricsByMember = metricsMap(response);
  return (response.players ?? []).map((player) => {
    const distribution = metricsByMember.get(player.memberId)?.rank.distribution ?? [];
    const totalCount = distribution.reduce((sum, item) => sum + item.count, 0);
    return {
      memberId: player.memberId,
      segments: distribution
        .toSorted((a, b) => a.rank - b.rank)
        .map((item) => ({
          count: item.count,
          rank: item.rank,
          rate: item.rate,
        })),
      totalCount,
    };
  });
}

export function playOrderHeatmapRows(response: SeriesComparisonResponse): PlayOrderHeatmapRow[] {
  const metricsByMember = metricsMap(response);
  return (response.players ?? []).map((player) => {
    const breakdown = metricsByMember.get(player.memberId)?.playOrder.breakdown ?? [];
    const byPlayOrder = new Map(breakdown.map((item) => [item.playOrder, item]));
    return {
      memberId: player.memberId,
      cells: [1, 2, 3, 4].map((playOrder) => {
        const item = byPlayOrder.get(playOrder);
        return {
          matchCount: item?.matchCount ?? 0,
          playOrder,
          rankAverage: isNumber(item?.rankAverage) ? item.rankAverage : undefined,
        };
      }),
    };
  });
}

export function revenueRankConversionEntries(
  response: SeriesComparisonResponse,
): RevenueRankConversionEntry[] {
  const pointsByMember = matchPlayerPointsByMember(response);
  return (response.players ?? []).map((player) => {
    const points = (pointsByMember.get(player.memberId) ?? []).filter(
      (point) => isNumber(point.revenueRank) && Number.isInteger(point.rank),
    );
    const revenueRanks = Array.from(new Set(points.map((point) => point.revenueRank))).toSorted(
      (a, b) => a - b,
    );
    return {
      memberId: player.memberId,
      rows: revenueRanks.map((revenueRank) => {
        const rowPoints = points.filter((point) => point.revenueRank === revenueRank);
        const targetCount = rowPoints.length;
        return {
          finalRankCounts: [1, 2, 3, 4].map((rank) => {
            const count = rowPoints.filter((point) => point.rank === rank).length;
            return {
              count,
              rank,
              rate: targetCount > 0 ? count / targetCount : undefined,
            };
          }),
          revenueRank,
          targetCount,
        };
      }),
    };
  });
}

export const cardShopDestinationDefinitions = [
  {
    color: "var(--color-success)",
    kind: "destination_with_shop",
    label: "到着あり × 売り場あり",
  },
  {
    color: "var(--color-action)",
    kind: "destination_without_shop",
    label: "到着あり × 売り場なし",
  },
  {
    color: "var(--color-warning)",
    kind: "no_destination_with_shop",
    label: "到着なし × 売り場あり",
  },
  {
    color: "var(--color-tray-incident)",
    kind: "no_destination_without_shop",
    label: "到着なし × 売り場なし",
  },
] as const satisfies ReadonlyArray<{
  color: string;
  kind: CardShopDestinationQuadrant["kind"];
  label: string;
}>;

export function cardShopQuadrantsByKind(
  entry: CardShopDestinationEntry | undefined,
): Map<CardShopDestinationQuadrant["kind"], CardShopDestinationQuadrant> {
  return new Map((entry?.quadrants ?? []).map((quadrant) => [quadrant.kind, quadrant]));
}

function matchPlayerPointsByMember(
  response: SeriesComparisonResponse,
): Map<string, MatchPlayerPoint[]> {
  const result = new Map<string, MatchPlayerPoint[]>();
  for (const point of response.matchPlayerPoints ?? []) {
    const current = result.get(point.memberId) ?? [];
    current.push(point);
    result.set(point.memberId, current);
  }
  return result;
}

function pointSort(left: MatchPlayerPoint, right: MatchPlayerPoint): number {
  return left.matchIndex - right.matchIndex || left.matchId.localeCompare(right.matchId);
}

function statusForTargetCount(targetCount: number): string {
  if (targetCount === 0) {
    return "no_target";
  }
  return targetCount < 3 ? "reference" : "normal";
}
