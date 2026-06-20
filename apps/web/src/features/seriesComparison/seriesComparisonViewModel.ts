import type {
  SeriesComparisonOptionsResponse,
  SeriesComparisonQuery,
  SeriesComparisonReviewQuery,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";
import { matchFeatureLabel } from "@/shared/domain/matchFeatures";

import { averageRankSpreadBands } from "./seriesComparisonThresholds";

export type SeriesComparisonUrlState = {
  gameTitleId?: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  view?: SeriesComparisonViewId | undefined;
};

export type SeriesComparisonViewId = "context" | "drivers" | "flow" | "overview" | "review";

type PlayerMetrics = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number]["metrics"];
type PlayOrderBreakdown = NonNullable<PlayerMetrics["playOrder"]["breakdown"]>[number];
type NullableNumber = number | null | undefined;
type DefensivePlayOrderBreakdown = Omit<PlayOrderBreakdown, "rankAverage"> & {
  rankAverage?: NullableNumber;
};
type DefensivePlayerMetrics = Omit<PlayerMetrics, "playOrder"> & {
  playOrder: Omit<PlayerMetrics["playOrder"], "breakdown"> & {
    breakdown?: DefensivePlayOrderBreakdown[];
  };
};
type RankedPlayOrderBreakdown = PlayOrderBreakdown & { rankAverage: number };

export type PlayOrderSignal = {
  best: RankedPlayOrderBreakdown | undefined;
  spread: number | undefined;
  worst: RankedPlayOrderBreakdown | undefined;
};

export type ProfileKind = NonNullable<
  NonNullable<
    SeriesComparisonResponse["playerPerformanceProfiles"]["entries"]
  >[number]["profileKind"]
>;

const legacyScopeKinds = new Set(["overall", "season", "map"]);
const viewIds = new Set(["review", "overview", "flow", "drivers", "context"]);
export const defaultSeriesComparisonView: SeriesComparisonViewId = "review";

function isNumber(value: NullableNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSeriesComparisonViewId(
  value: string | null | undefined,
): value is SeriesComparisonViewId {
  return viewIds.has(value ?? "");
}

function normalizeView(value: string | undefined): SeriesComparisonViewId {
  return isSeriesComparisonViewId(value) ? value : defaultSeriesComparisonView;
}

export function parseSeriesComparisonSearchParams(
  params: URLSearchParams,
): SeriesComparisonUrlState {
  const gameTitleId = params.get("gameTitleId")?.trim() || undefined;
  const seasonMasterId = params.get("seasonMasterId")?.trim() || undefined;
  const mapMasterId = params.get("mapMasterId")?.trim() || undefined;
  const view = normalizeView(params.get("view")?.trim());
  if (seasonMasterId || mapMasterId) {
    return {
      gameTitleId,
      mapMasterId,
      seasonMasterId,
      view,
    };
  }

  const rawKind = params.get("scopeKind")?.trim();
  const scopeKind = legacyScopeKinds.has(rawKind ?? "") ? rawKind : "overall";
  const scopeId = params.get("scopeId")?.trim() || undefined;
  return {
    gameTitleId,
    mapMasterId: scopeKind === "map" ? scopeId : undefined,
    seasonMasterId: scopeKind === "season" ? scopeId : undefined,
    view,
  };
}

export function buildSeriesComparisonSearchParams(
  state: SeriesComparisonUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  const view = normalizeView(state.view);
  if (state.gameTitleId) {
    params.set("gameTitleId", state.gameTitleId);
  }
  if (state.seasonMasterId) {
    params.set("seasonMasterId", state.seasonMasterId);
  }
  if (state.mapMasterId) {
    params.set("mapMasterId", state.mapMasterId);
  }
  if (view !== defaultSeriesComparisonView) {
    params.set("view", view);
  }
  return params;
}

export function normalizeSeriesComparisonSelection(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): SeriesComparisonUrlState {
  const series = options?.series ?? [];
  const view = normalizeView(state.view);
  const fallbackGameTitleId = options?.latestConfirmedGameTitleId ?? series[0]?.gameTitleId;
  const selectedSeries =
    series.find((item) => item.gameTitleId === state.gameTitleId) ??
    series.find((item) => item.gameTitleId === fallbackGameTitleId) ??
    series[0];

  if (!selectedSeries) {
    return {
      gameTitleId: undefined,
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view,
    };
  }

  const selectedSeason = (selectedSeries.seasons ?? []).find(
    (item) => item.id === state.seasonMasterId,
  );
  const selectedMap = (selectedSeries.maps ?? []).find((item) => item.id === state.mapMasterId);
  return {
    gameTitleId: selectedSeries.gameTitleId,
    mapMasterId: selectedMap?.id,
    seasonMasterId: selectedSeason?.id,
    view,
  };
}

export function seriesComparisonQueryFromState(
  state: SeriesComparisonUrlState,
): SeriesComparisonQuery | undefined {
  if (!state.gameTitleId) {
    return undefined;
  }
  return {
    gameTitleId: state.gameTitleId,
    mapMasterId: state.mapMasterId,
    seasonMasterId: state.seasonMasterId,
  };
}

export function seriesComparisonReviewQueryFromState(
  state: SeriesComparisonUrlState,
): SeriesComparisonReviewQuery | undefined {
  const query = seriesComparisonQueryFromState(state);
  if (!query) {
    return undefined;
  }
  return {
    ...query,
  };
}

export function findSelectedSeries(
  options: SeriesComparisonOptionsResponse | undefined,
  gameTitleId: string | undefined,
) {
  return (options?.series ?? []).find((series) => series.gameTitleId === gameTitleId);
}

export function scopeNameForState(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): string {
  const selectedSeries = findSelectedSeries(options, state.gameTitleId);
  if (!selectedSeries) {
    return "";
  }
  if (!state.seasonMasterId && !state.mapMasterId) {
    return "総合";
  }
  const seasonName =
    (selectedSeries.seasons ?? []).find((item) => item.id === state.seasonMasterId)?.name ??
    "全シーズン";
  const mapName =
    (selectedSeries.maps ?? []).find((item) => item.id === state.mapMasterId)?.name ?? "全マップ";
  return `${seasonName} / ${mapName}`;
}

export function averageRankSpread(response: SeriesComparisonResponse): {
  label: string;
  spread: number | undefined;
  tone: "flat" | "small" | "visible" | "large";
} {
  const values = (response.metricsByPlayer ?? [])
    .map((entry) => entry.metrics.rank.average)
    .filter(isNumber);
  if (values.length < 2) {
    return { label: "比較材料不足", spread: undefined, tone: "flat" };
  }
  const spread = Math.max(...values) - Math.min(...values);
  const bands = averageRankSpreadBands(response.matchCount);
  if (spread < bands.flatBelow) {
    return { label: "横一線", spread, tone: "flat" };
  }
  if (spread < bands.smallBelow) {
    return { label: "小差", spread, tone: "small" };
  }
  if (spread < bands.largeFrom) {
    return { label: "中差", spread, tone: "visible" };
  }
  return { label: "はっきり差", spread, tone: "large" };
}

export function playOrderSignal(metrics: DefensivePlayerMetrics | undefined): PlayOrderSignal {
  const ranked = (metrics?.playOrder.breakdown ?? [])
    .filter((item): item is RankedPlayOrderBreakdown => isNumber(item.rankAverage))
    .toSorted((a, b) => a.rankAverage - b.rankAverage);
  const best = ranked[0];
  const worst = ranked.at(-1);
  return {
    best,
    spread: best && worst && ranked.length >= 2 ? worst.rankAverage - best.rankAverage : undefined,
    worst,
  };
}

export function ginjiSummary(response: SeriesComparisonResponse): {
  abnormalMatches: number;
  totalEncounters: number;
  warningPlayerIds: string[];
} {
  const entries = response.metricsByPlayer ?? [];
  return {
    abnormalMatches: entries.reduce(
      (sum, entry) => sum + entry.metrics.ginji.multiEncounterMatchCount,
      0,
    ),
    totalEncounters: entries.reduce((sum, entry) => sum + entry.metrics.ginji.count, 0),
    warningPlayerIds: entries
      .filter((entry) => entry.metrics.ginji.multiEncounterMatchCount > 0)
      .map((entry) => entry.memberId),
  };
}

export function qualitySummary(response: SeriesComparisonResponse): {
  noTargetCount: number;
  referenceCount: number;
} {
  const items = response.dataQuality.items ?? [];
  return {
    noTargetCount: items.filter((item) => item.status === "no_target").length,
    referenceCount: items.filter((item) => item.status === "reference").length,
  };
}

export function profileKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "steady_leader":
      return "安定上位";
    case "swing_leader":
      return "爆発上位";
    case "steady_chaser":
      return "安定追走";
    case "swing_chaser":
      return "波あり追走";
    default:
      return "判定なし";
  }
}

export function strategyKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "property_focused":
      return "桃鉄型（物件重視）";
    case "card_focused":
      return "遊戯王型（カード重視）";
    case "balanced":
      return "バランス型";
    default:
      return "判定なし";
  }
}

export function assetStyleKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "asset_explosion":
      return "資産爆発型";
    case "steady_accumulator":
      return "堅実積み上げ型";
    case "high_risk_breakthrough":
      return "ハイリスク突破型";
    case "close_collector":
      return "接戦回収型";
    case "upper_chaser":
      return "上位追走型";
    case "balanced":
      return "バランス型";
    default:
      return "判定なし";
  }
}

export function assetStyleShapeLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "two_tailed":
      return "高資産も低資産も多い";
    case "upper_side":
      return "低資産が少なく、高資産寄り";
    case "lower_tail":
      return "低資産が多い";
    case "thin_right_tail":
      return "高資産が少ない";
    case "right_tail":
      return "高資産まで伸びる";
    case "middle_heavy":
      return "中央帯が厚い";
    default:
      return "形状なし";
  }
}

export function assetStyleTagLabel(tag: string): string {
  switch (tag) {
    case "high_variance":
      return "振れ幅大";
    case "mobility_collecting":
      return "目的地寄り";
    case "upper_chaser":
      return "上位追走";
    case "property_base":
      return "物件基盤";
    case "downside_risk":
      return "下振れ注意";
    case "card_base":
      return "カード寄り";
    case "close_finish":
      return "接戦寄り";
    default:
      return tag;
  }
}

export function timelineFlagLabel(flag: string): string {
  return matchFeatureLabel(flag);
}

export function statusLabel(status: string | null | undefined): string | undefined {
  switch (status) {
    case "reference":
      return "参考";
    case "no_target":
    case "empty":
      return "対象なし";
    case "limited":
      return "少数";
    case "self":
      return undefined;
    default:
      return undefined;
  }
}
