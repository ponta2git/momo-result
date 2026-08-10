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
      return signal;
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
      return value;
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
      return "物件寄り";
    case "card_focused":
      return "カード寄り";
    case "balanced":
      return "均衡";
    default:
      return "—";
  }
}
