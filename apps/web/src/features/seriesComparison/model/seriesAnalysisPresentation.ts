import type {
  ChangeDirection,
  SeriesAnalysisPlayer,
  RelativeIntensity,
  SeriesAnalysisPlaybookCategory,
  SeriesAnalysisPlaybookClassification,
  SeriesAnalysisPlaybookEvidenceStrength,
} from "@/shared/api/seriesAnalysis";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { formatManYen as formatStoredManYen } from "@/shared/lib/formatters";

const numberFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 });
const percentFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 1,
  style: "percent",
});

export function formatDecimal(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numberFormatter.format(value);
}

export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : integerFormatter.format(value);
}

export function formatManYen(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatStoredManYen(value);
}

export function formatHistogramManYenBin({
  lowerInclusive,
  upperExclusive,
}: {
  lowerInclusive: number;
  upperExclusive: number | null;
}): string {
  if (lowerInclusive === 0 && upperExclusive === 1) return "0円";
  if (upperExclusive === null) return `${formatStoredManYen(lowerInclusive)}以上`;
  const upperInclusive = upperExclusive - 1;
  const upperLabel = upperInclusive === 0 ? "0円" : formatStoredManYen(upperInclusive);
  return `${formatStoredManYen(lowerInclusive)}〜${upperLabel}`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : percentFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeLong(value ?? undefined, "—");
}

export function intensityClassName(intensity: RelativeIntensity): string {
  switch (intensity) {
    case "high":
      return "bg-[var(--color-analysis-emphasis)]/24";
    case "medium":
      return "bg-[var(--color-analysis-emphasis)]/16";
    case "low":
      return "bg-[var(--color-analysis-emphasis)]/8";
    case "none":
      return "bg-[var(--color-surface)]";
  }
}

export function directionLabel(direction: ChangeDirection | "unavailable"): string {
  switch (direction) {
    case "improved":
      return "改善";
    case "declined":
      return "後退";
    case "unchanged":
      return "維持";
    case "first_observation":
      return "初戦";
    case "unavailable":
      return "比較不可";
  }
}

const headToHeadSignalLabels = new Map([
  ["strong_advantage", "優勢"],
  ["slight_advantage", "やや優勢"],
  ["strong_disadvantage", "劣勢"],
  ["slight_disadvantage", "やや劣勢"],
  ["neutral", "互角"],
  ["reference", "参考"],
  ["no_target", "対象なし"],
]);

export function headToHeadSignalLabel(signal: string | undefined): string {
  return headToHeadSignalLabels.get(signal ?? "") ?? "—";
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

const evidenceStrengthLabels = new Map([
  ["high", "高め"],
  ["medium", "中"],
]);

export function evidenceStrengthLabel(
  value: SeriesAnalysisPlaybookEvidenceStrength | undefined,
): string {
  return evidenceStrengthLabels.get(value ?? "") ?? "控えめ";
}

const timelineFlagLabels = new Map([
  ["revenue_top_no_win", "収益首位でも未勝利"],
  ["ginji_storm", "銀次が複数回"],
  ["close_finish", "接戦"],
  ["asset_blowout", "資産差大"],
]);

export function timelineFlagLabel(value: string): string {
  return timelineFlagLabels.get(value) ?? "その他の注目点";
}

const matchFeatureLabels = new Map([
  ["close_finish", "上位が接戦"],
  ["asset_blowout", "総資産差が大きい"],
  ["revenue_top_no_win", "物件収益首位が未勝利"],
  ["ginji_storm", "スリの銀次が複数回"],
  ["negative_assets", "マイナス資産あり"],
  ["no_destination", "目的地到着なし"],
]);

export function matchFeatureLabel(code: string): string {
  return matchFeatureLabels.get(code) ?? "試合上の注目点";
}

const cardShopKindLabels = new Map([
  ["destination_with_shop", "目的地あり・売り場あり"],
  ["destination_without_shop", "目的地あり・売り場なし"],
  ["no_destination_with_shop", "目的地なし・売り場あり"],
  ["no_destination_without_shop", "目的地なし・売り場なし"],
]);

export function cardShopKindLabel(kind: string): string {
  return cardShopKindLabels.get(kind) ?? "条件不明";
}

const profileLabels = new Map([
  ["steady_leader", "安定先行"],
  ["swing_leader", "変動先行"],
  ["steady_chaser", "安定追走"],
  ["swing_chaser", "変動追走"],
  ["property_focused", "桃鉄型（物件重視）"],
  ["card_focused", "遊戯王型（カード重視）"],
  ["balanced", "均衡"],
]);

export function profileLabel(value: string | null): string {
  return profileLabels.get(value ?? "") ?? "—";
}

const highlightMetricLabels = new Map([
  ["rank.average", "平均順位が最上位"],
  ["assets.average", "平均総資産が最大"],
  ["revenue.average", "平均物件収益が最大"],
  ["podium.rate", "入賞率が最大"],
]);

export function highlightMetricLabel(metricId: string): string {
  return highlightMetricLabels.get(metricId) ?? "比較上位";
}

const reviewEvidenceLabels = new Map([
  ["revenue.topWinRate", "収益上位時の勝率"],
  ["playbook.driver.destinationCount", "目的地到着数との関係"],
  ["playbook.driver.revenueRank", "物件収益順位との関係"],
  ["playbook.driver.incidentAvoidance", "事故回避との関係"],
  ["playbook.driver.cardShop", "カード売り場との関係"],
]);

export function formatHighlightValue(metricId: string, value: number): string {
  if (metricId === "assets.average" || metricId === "revenue.average") {
    return formatManYen(value);
  }
  if (metricId === "podium.rate") return formatPercent(value);
  if (metricId === "rank.average") return `${formatDecimal(value)}位`;
  return formatDecimal(value);
}

export function reviewEvidenceLabel(metricId: string): string {
  return reviewEvidenceLabels.get(metricId) ?? "判断材料";
}

export function playerName(players: SeriesAnalysisPlayer[], memberId: string): string {
  return (
    players.find((player) => player.memberId === memberId)?.displayName ?? "プレーヤー名未取得"
  );
}

export function memberNames(players: SeriesAnalysisPlayer[], memberIds: string[]): string {
  return memberIds.map((memberId) => playerName(players, memberId)).join("、") || "—";
}
