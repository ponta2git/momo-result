import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { formatManYen } from "@/shared/lib/formatters";

import { SERIES_COMPARISON_THRESHOLDS } from "./seriesComparisonThresholds";

export type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type MetricsEntry = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number];
export type PlayerMetrics = MetricsEntry["metrics"];
export type RecentFormEntry = NonNullable<SeriesComparisonResponse["recentFormByPlayer"]>[number];
export type MomentumSwitchEntry = NonNullable<
  SeriesComparisonResponse["momentumSwitch"]["entries"]
>[number];
export type MomentumSwitchRateKey = "afterFourth" | "afterLower" | "afterPodium";
export type PerformanceProfileEntry = NonNullable<
  SeriesComparisonResponse["playerPerformanceProfiles"]["entries"]
>[number];
export type AssetStyleProfileEntry = NonNullable<
  SeriesComparisonResponse["assetStyleProfiles"]["entries"]
>[number];
export type MatchNoBreakdown = NonNullable<
  SeriesComparisonResponse["matchNoInEventBreakdown"]
>[number];
export type MatchPlayerPoint = NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number];
export type MetricEmphasis = {
  kind: "evidence" | "leader" | "risk" | "strength";
  label: string;
};
export type RecentRankStripEntry = {
  memberId: string;
  points: Array<{
    matchId: string;
    matchIndex: number;
    rank: number;
  }>;
  status: string;
  targetCount: number;
  totalCount: number;
  windowSize: number;
};
export type RankDistributionBarEntry = {
  memberId: string;
  segments: Array<{
    count: number;
    rank: number;
    rate: number | undefined;
  }>;
  totalCount: number;
};
export type PlayOrderHeatmapRow = {
  cells: Array<{
    matchCount: number;
    playOrder: number;
    rankAverage: number | undefined;
  }>;
  memberId: string;
};
export type RevenueRankConversionEntry = {
  memberId: string;
  rows: Array<{
    finalRankCounts: Array<{
      count: number;
      rank: number;
      rate: number | undefined;
    }>;
    revenueRank: number;
    targetCount: number;
  }>;
};
type NullableNumber = number | null | undefined;
export type NumericExtrema = {
  max: number | undefined;
  min: number | undefined;
};

export function isNumber(value: NullableNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatDecimal(value: NullableNumber, digits = 2): string {
  return isNumber(value) ? value.toFixed(digits) : "-";
}

export function formatSigned(value: NullableNumber, unit = ""): string {
  if (!isNumber(value)) {
    return "-";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${unit}`;
}

export function formatSignedPercentPoint(value: NullableNumber): string {
  if (!isNumber(value)) {
    return "-";
  }
  const point = value * 100;
  const sign = point > 0 ? "+" : "";
  return `${sign}${point.toFixed(1)}pt`;
}

export function formatPercent(value: NullableNumber): string {
  return isNumber(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

export function formatCountRate({
  count,
  rate,
  targetCount,
  unit = "戦",
}: {
  count?: NullableNumber;
  rate?: NullableNumber;
  targetCount?: NullableNumber;
  unit?: string;
}): string {
  if (!isNumber(targetCount) || targetCount <= 0) {
    return "対象なし";
  }
  return `${isNumber(count) ? count : 0}/${targetCount}${unit}・${formatPercent(rate)}`;
}

export function formatMoney(value: NullableNumber): string {
  return isNumber(value) ? formatManYen(Math.round(value)) : "-";
}

export function formatPlayOrderLabel(playOrder: NullableNumber): string {
  return isNumber(playOrder) ? `${playOrder}P` : "P不明";
}

export function playOrderColor(playOrder: NullableNumber): string {
  const colors = [
    "var(--color-player-1)",
    "var(--color-player-2)",
    "var(--color-player-3)",
    "var(--color-player-4)",
  ];
  return isNumber(playOrder)
    ? (colors[playOrder - 1] ?? "var(--color-text-muted)")
    : "var(--color-text-muted)";
}

export function metricsMap(response: SeriesComparisonResponse): Map<string, PlayerMetrics> {
  return new Map((response.metricsByPlayer ?? []).map((entry) => [entry.memberId, entry.metrics]));
}

export function recentFormMap(response: SeriesComparisonResponse): Map<string, RecentFormEntry> {
  return new Map((response.recentFormByPlayer ?? []).map((entry) => [entry.memberId, entry]));
}

export function momentumSwitchMap(
  response: SeriesComparisonResponse,
): Map<string, MomentumSwitchEntry> {
  return new Map((response.momentumSwitch.entries ?? []).map((entry) => [entry.memberId, entry]));
}

export function momentumSwitchEmphasis(
  kind: MomentumSwitchRateKey,
  deltaFromBaseline: NullableNumber,
  status: string | null | undefined,
): MetricEmphasis | undefined {
  if (status !== "ok" || !isNumber(deltaFromBaseline)) {
    return undefined;
  }
  const threshold = SERIES_COMPARISON_THRESHOLDS.momentumSwitch.deltaPointThresholds[kind];
  if (kind === "afterPodium") {
    if (deltaFromBaseline <= -threshold) {
      return { kind: "strength", label: "強み" };
    }
    if (deltaFromBaseline >= threshold) {
      return { kind: "risk", label: "注意" };
    }
    return undefined;
  }
  if (deltaFromBaseline >= threshold) {
    return { kind: "strength", label: "強み" };
  }
  if (deltaFromBaseline <= -threshold) {
    return { kind: "risk", label: "注意" };
  }
  return undefined;
}

export function performanceProfileMap(
  response: SeriesComparisonResponse,
): Map<string, PerformanceProfileEntry> {
  return new Map(
    (response.playerPerformanceProfiles.entries ?? []).map((entry) => [entry.memberId, entry]),
  );
}

export function assetStyleProfileMap(
  response: SeriesComparisonResponse,
): Map<string, AssetStyleProfileEntry> {
  return new Map(
    (response.assetStyleProfiles.entries ?? []).map((entry) => [entry.memberId, entry]),
  );
}

export function playerNameMap(players: Player[]): Map<string, string> {
  return new Map(players.map((player) => [player.memberId, player.displayName]));
}

export function recentRankStrips(response: SeriesComparisonResponse): RecentRankStripEntry[] {
  const recentByMember = recentFormMap(response);
  const pointsByMember = matchPlayerPointsByMember(response);
  return (response.players ?? []).map((player) => {
    const form = recentByMember.get(player.memberId);
    const windowSize = form?.windowSize ?? 8;
    const points = (pointsByMember.get(player.memberId) ?? []).toSorted(pointSort);
    const recentPoints = points.slice(-windowSize);
    return {
      memberId: player.memberId,
      points: points.map((point) => ({
        matchId: point.matchId,
        matchIndex: point.matchIndex,
        rank: point.rank,
      })),
      status: form?.status ?? statusForTargetCount(recentPoints.length),
      targetCount: form?.targetCount ?? recentPoints.length,
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

export function numericExtrema(
  response: SeriesComparisonResponse,
  select: (metrics: PlayerMetrics) => NullableNumber,
): NumericExtrema {
  const values = (response.metricsByPlayer ?? [])
    .map((entry) => select(entry.metrics))
    .filter(isNumber);
  return values.length === 0
    ? { max: undefined, min: undefined }
    : { max: Math.max(...values), min: Math.min(...values) };
}

export function extremumEmphasis(
  value: NullableNumber,
  extrema: NumericExtrema,
  target: "max" | "min",
  emphasis: MetricEmphasis,
): MetricEmphasis | undefined {
  const targetValue = extrema[target];
  if (!isNumber(value) || targetValue === undefined || extrema.max === extrema.min) {
    return undefined;
  }
  return value === targetValue ? emphasis : undefined;
}

export function leaderSummary(response: SeriesComparisonResponse): {
  averageRank: number | undefined;
  gapToSecond: number | undefined;
  name: string | undefined;
} {
  const playersById = new Map((response.players ?? []).map((player) => [player.memberId, player]));
  const ranked = (response.metricsByPlayer ?? [])
    .flatMap((entry) => {
      const averageRank = entry.metrics.rank.average;
      return isNumber(averageRank) ? [{ averageRank, memberId: entry.memberId }] : [];
    })
    .toSorted((a, b) => a.averageRank - b.averageRank);
  const leader = ranked[0];
  if (!leader) {
    return { averageRank: undefined, gapToSecond: undefined, name: undefined };
  }
  return {
    averageRank: leader.averageRank,
    gapToSecond: ranked[1] ? ranked[1].averageRank - leader.averageRank : undefined,
    name: playersById.get(leader.memberId)?.displayName ?? leader.memberId,
  };
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
