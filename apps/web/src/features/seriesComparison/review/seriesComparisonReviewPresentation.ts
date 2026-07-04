import type { SeriesComparisonReviewResponse } from "@/shared/api/seriesComparison";

type ReviewPlayerPlaybook = NonNullable<SeriesComparisonReviewResponse["playbookByPlayer"]>[number];
type ReviewPlaybookCard = NonNullable<ReviewPlayerPlaybook["cards"]>[number];
type ReviewPlaybookEvidence = NonNullable<ReviewPlaybookCard["evidence"]>[number];

export function reviewPlaybookLane(card: Pick<ReviewPlaybookCard, "classification">): {
  className: string;
  label: string;
  order: number;
} {
  if (card.classification === "reproduce") {
    return {
      className:
        "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]",
      label: "再現する",
      order: 1,
    };
  }
  if (card.classification === "revise") {
    return {
      className:
        "border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
      label: "見直す",
      order: 2,
    };
  }
  return {
    className:
      "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
    label: "検証する",
    order: 3,
  };
}

export function reviewPlaybookCardOrder(
  a: Pick<ReviewPlaybookCard, "actionAdviceScore" | "classification">,
  b: Pick<ReviewPlaybookCard, "actionAdviceScore" | "classification">,
): number {
  const laneOrder = reviewPlaybookLane(a).order - reviewPlaybookLane(b).order;
  if (laneOrder !== 0) {
    return laneOrder;
  }
  return b.actionAdviceScore - a.actionAdviceScore;
}

export function playbookCategoryLabel(category: string): string {
  switch (category) {
    case "revenue":
      return "物件収益";
    case "destinationPositive":
      return "目的地後";
    case "destination":
      return "目的地";
    case "accident":
      return "事故後";
    case "assets":
      return "資産";
    case "playOrder":
      return "番手";
    case "recovery":
      return "下位後の戻し方";
    case "ginji":
      return "スリの銀次";
    default:
      return "その他";
  }
}

export function playbookEvidenceStrengthLabel(strength: string): string {
  switch (strength) {
    case "strong":
      return "強い";
    case "diagnostic":
      return "診断のみ";
    case "verify":
      return "検証向き";
    default:
      return "検証向き";
  }
}

export function playbookEvidenceStatusLabel(status: string): string {
  switch (status) {
    case "ok":
      return "高";
    case "reference":
      return "参考";
    case "insufficient":
      return "件数少";
    case "no_target":
      return "対象なし";
    default:
      return "根拠";
  }
}

export function evidenceStats(item: ReviewPlaybookEvidence): string[] {
  const effectEstimate = finiteNumberOrUndefined(item.effectEstimate);
  const confidenceLow = finiteNumberOrUndefined(item.confidenceLow);
  const confidenceHigh = finiteNumberOrUndefined(item.confidenceHigh);
  const stability = finiteNumberOrUndefined(item.stability);
  return [
    effectEstimate === undefined ? undefined : `差の大きさ ${signedDecimal(effectEstimate)}`,
    confidenceLow === undefined || confidenceHigh === undefined
      ? undefined
      : `ぶれ幅 ${signedDecimal(confidenceLow)}〜${signedDecimal(confidenceHigh)}`,
    stability === undefined ? undefined : `ぶれにくさ ${stabilityLabel(stability)}`,
  ].filter((value): value is string => value !== undefined);
}

export function signedDecimal(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

export function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stabilityLabel(value: number): string {
  if (value >= 0.75) {
    return "高";
  }
  if (value >= 0.5) {
    return "中";
  }
  return "低";
}
