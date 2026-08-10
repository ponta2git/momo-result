import type {
  ChangeDirection,
  DataQualityStatus,
  RelativeIntensity,
  SeriesAnalysisPlaybookCategory,
  SeriesAnalysisPlaybookClassification,
  SeriesAnalysisPlaybookEvidenceStrength,
} from "@/shared/api/seriesAnalysis";

const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 1,
  style: "percent",
});
const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDecimal(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : integerFormatter.format(value);
}

export function formatManYen(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${integerFormatter.format(value)}万円`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : percentFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

export function qualityLabel(status: DataQualityStatus): string {
  switch (status) {
    case "ok":
      return "十分";
    case "reference":
      return "参考";
    case "no_target":
      return "対象なし";
  }
}

export function intensityClassName(intensity: RelativeIntensity): string {
  switch (intensity) {
    case "high":
      return "bg-[var(--color-action)]/24";
    case "medium":
      return "bg-[var(--color-action)]/16";
    case "low":
      return "bg-[var(--color-action)]/8";
    case "none":
      return "bg-[var(--color-surface)]";
  }
}

export function directionLabel(direction: ChangeDirection): string {
  switch (direction) {
    case "improved":
      return "改善";
    case "declined":
      return "低下";
    case "unchanged":
      return "変化なし";
    case "first_observation":
      return "初回";
    case "unavailable":
      return "比較不可";
  }
}

export function rankSignalLabel(signal: string): string {
  switch (signal) {
    case "revenue":
      return "物件収益";
    case "destination":
      return "目的地";
    case "plus_station":
      return "プラス駅";
    case "minus_station":
      return "マイナス駅";
    case "card_station":
      return "カード駅";
    case "card_shop":
      return "カード売り場";
    case "ginji":
      return "スリの銀次";
    default:
      return "その他の要因";
  }
}

export function headToHeadSignalLabel(signal: string | undefined): string {
  switch (signal) {
    case "strong_advantage":
      return "優勢";
    case "slight_advantage":
      return "やや優勢";
    case "strong_disadvantage":
      return "劣勢";
    case "slight_disadvantage":
      return "やや劣勢";
    case "neutral":
      return "互角";
    case "reference":
      return "参考";
    case "no_target":
      return "対象なし";
    default:
      return "—";
  }
}

export function playbookCategoryLabel(category: SeriesAnalysisPlaybookCategory): string {
  switch (category) {
    case "revenue":
      return "物件収益";
    case "destination":
      return "目的地";
    case "destinationPositive":
      return "目的地到着後";
    case "assets":
      return "低資産";
    case "playOrder":
      return "番手";
    case "ginji":
      return "スリの銀次";
    case "recovery":
      return "下位後の戻し方";
    case "accident":
      return "事故後";
  }
}

export function classificationLabel(value: SeriesAnalysisPlaybookClassification): string {
  switch (value) {
    case "reproduce":
      return "再現する";
    case "revise":
      return "見直す";
    case "verify":
      return "検証する";
  }
}

export function evidenceStrengthLabel(
  value: SeriesAnalysisPlaybookEvidenceStrength | undefined,
): string {
  switch (value) {
    case "high":
      return "高め";
    case "medium":
      return "中";
    default:
      return "控えめ";
  }
}

export function timelineFlagLabel(value: string): string {
  switch (value) {
    case "revenue_top_no_win":
      return "収益首位でも未勝利";
    case "ginji_storm":
      return "銀次が複数回";
    case "close_finish":
      return "接戦";
    case "asset_blowout":
      return "資産差大";
    default:
      return "その他の注目点";
  }
}

export function matchFeatureLabel(code: string): string {
  switch (code) {
    case "close_finish":
      return "上位が接戦";
    case "asset_blowout":
      return "総資産差が大きい";
    case "revenue_top_no_win":
      return "物件収益首位が未勝利";
    case "ginji_storm":
      return "スリの銀次が複数回";
    case "negative_assets":
      return "マイナス資産あり";
    case "no_destination":
      return "目的地到着なし";
    case "destination_burst":
      return "目的地到着が集中";
    case "low_revenue_win":
      return "低収益から勝利";
    case "fourth_order_win":
      return "4番手から勝利";
    default:
      return "試合上の注目点";
  }
}

export function cardShopKindLabel(kind: string): string {
  switch (kind) {
    case "destination_with_shop":
      return "目的地あり・売り場あり";
    case "destination_without_shop":
      return "目的地あり・売り場なし";
    case "no_destination_with_shop":
      return "目的地なし・売り場あり";
    case "no_destination_without_shop":
      return "目的地なし・売り場なし";
    default:
      return "条件不明";
  }
}

export function profileLabel(value: string | null): string {
  switch (value) {
    case "steady_leader":
      return "安定先行";
    case "swing_leader":
      return "変動先行";
    case "steady_chaser":
      return "安定追走";
    case "swing_chaser":
      return "変動追走";
    case "property_focused":
      return "桃鉄型（物件重視）";
    case "card_focused":
      return "遊戯王型（カード重視）";
    case "balanced":
      return "均衡";
    default:
      return "—";
  }
}

export function assetStyleLabel(value: string | null): string {
  switch (value) {
    case "asset_explosion":
      return "高資産まで伸ばす試合が多い";
    case "high_risk_breakthrough":
      return "低資産と上位が同居する";
    case "steady_accumulator":
      return "低資産で終える試合が少ない";
    case "balanced":
      return "資産帯の偏りが小さい";
    default:
      return "傾向を判定できません";
  }
}

export function highlightMetricLabel(metricId: string): string {
  switch (metricId) {
    case "rank.average":
      return "平均順位が最上位";
    case "assets.average":
      return "平均総資産が最大";
    case "revenue.average":
      return "平均物件収益が最大";
    case "podium.rate":
      return "入賞率が最大";
    default:
      return "比較上位";
  }
}

export function formatHighlightValue(metricId: string, value: number): string {
  if (metricId === "assets.average" || metricId === "revenue.average") {
    return formatManYen(value);
  }
  if (metricId === "podium.rate") return formatPercent(value);
  if (metricId === "rank.average") return `${formatDecimal(value)}位`;
  return formatDecimal(value);
}

export function reviewEvidenceLabel(metricId: string): string {
  switch (metricId) {
    case "revenue.topWinRate":
      return "収益上位時の勝率";
    case "playbook.driver.destinationCount":
      return "目的地到着数との関係";
    case "playbook.driver.revenueRank":
      return "物件収益順位との関係";
    case "playbook.driver.incidentAvoidance":
      return "事故回避との関係";
    case "playbook.driver.cardShop":
      return "カード売り場との関係";
    default:
      return "判断材料";
  }
}
