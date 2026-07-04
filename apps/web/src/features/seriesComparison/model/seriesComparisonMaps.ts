import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

import { isNumber } from "./seriesComparisonFormatters";
import type {
  AssetStyleProfileEntry,
  MetricEmphasis,
  MomentumSwitchEntry,
  MomentumSwitchRateKey,
  NullableNumber,
  NumericExtrema,
  PerformanceProfileEntry,
  Player,
  PlayerMetrics,
  RecentFormEntry,
} from "./seriesComparisonPresentationTypes";
import { SERIES_COMPARISON_THRESHOLDS } from "./seriesComparisonThresholds";

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
