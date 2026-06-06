import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { formatManYen } from "@/shared/lib/formatters";

export type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type MetricsEntry = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number];
export type PlayerMetrics = MetricsEntry["metrics"];
export type RecentFormEntry = NonNullable<SeriesComparisonResponse["recentFormByPlayer"]>[number];
export type PerformanceProfileEntry = NonNullable<
  SeriesComparisonResponse["playerPerformanceProfiles"]["entries"]
>[number];
export type MatchNoBreakdown = NonNullable<
  SeriesComparisonResponse["matchNoInEventBreakdown"]
>[number];
export type MetricTone = "neutral" | "high" | "low";
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
  const colors = ["#2563eb", "#dc2626", "#d9a300", "#16a34a"];
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

export function performanceProfileMap(
  response: SeriesComparisonResponse,
): Map<string, PerformanceProfileEntry> {
  return new Map(
    (response.playerPerformanceProfiles.entries ?? []).map((entry) => [entry.memberId, entry]),
  );
}

export function playerNameMap(players: Player[]): Map<string, string> {
  return new Map(players.map((player) => [player.memberId, player.displayName]));
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

export function extremumTone(
  value: NullableNumber,
  extrema: NumericExtrema,
  target: "max" | "min",
): MetricTone {
  const targetValue = extrema[target];
  if (!isNumber(value) || targetValue === undefined || extrema.max === extrema.min) {
    return "neutral";
  }
  return value === targetValue ? (target === "max" ? "high" : "low") : "neutral";
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
