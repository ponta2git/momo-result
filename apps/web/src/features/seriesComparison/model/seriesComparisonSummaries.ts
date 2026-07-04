import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { matchFeatureLabel } from "@/shared/domain/matchFeatures";

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

function isNumber(value: NullableNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function averageRankSpread(response: SeriesComparisonResponse): {
  label: string;
  spread: number | undefined;
  tone: "flat" | "small" | "visible" | "large";
} {
  const signal = response.rankSpreadSignal;
  switch (signal.signal) {
    case "flat":
      return { label: "横一線", spread: signal.spread ?? undefined, tone: "flat" };
    case "small":
      return { label: "小差", spread: signal.spread ?? undefined, tone: "small" };
    case "visible":
      return { label: "中差", spread: signal.spread ?? undefined, tone: "visible" };
    case "large":
      return { label: "はっきり差", spread: signal.spread ?? undefined, tone: "large" };
    default:
      return { label: "比較材料不足", spread: undefined, tone: "flat" };
  }
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
