import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export type RankAnalysis = SeriesComparisonResponse["rankAnalysis"];
export type RankSignal = NonNullable<
  NonNullable<RankAnalysis["rankSignalsByPlayer"]>[number]["signals"]
>[number];

const signalLabels: Record<string, string> = {
  card_shop: "カード売り場",
  card_station: "カード駅",
  destination: "目的地",
  ginji: "スリの銀次",
  minus_station: "マイナス駅",
  plus_station: "プラス駅",
  revenue: "物件収益",
};

export const rankSignalFoldLabels = ["A", "B", "C", "D", "E"] as const;

export function rankSignalLabel(signal: string): string {
  return signalLabels[signal] ?? "保存済み記録";
}

export function rankSignalDirectionLabel(signal: RankSignal): string {
  const subject = rankSignalLabel(signal.signal);
  return signal.direction === "less_is_higher"
    ? `${subject}が少ない試合ほど上位寄り`
    : `${subject}が多い試合ほど上位寄り`;
}

export function rankSignalPriorityLabel(index: number, signalCount: number): string {
  if (signalCount <= 1) return "この1件";
  if (index === 0) return "第一候補";
  if (index === 1) return "第二候補";
  return "補助候補";
}

export function rankSignalFoldLabel(fold: number): string {
  return rankSignalFoldLabels[fold] ?? String(fold + 1);
}

export function rankSignalCandidateShares(
  signals: ReadonlyArray<{ importance: number }>,
): number[] {
  const importances = signals.map(({ importance }) =>
    Number.isFinite(importance) && importance > 0 ? importance : 0,
  );
  const total = importances.reduce((sum, importance) => sum + importance, 0);
  if (total <= 0) return importances.map(() => 0);

  const exactShares = importances.map((importance) => (importance / total) * 100);
  const roundedShares = exactShares.map(Math.floor);
  const remainingPoints = 100 - roundedShares.reduce((sum, share) => sum + share, 0);
  const priority = exactShares
    .map((share, index) => ({ index, remainder: share - Math.floor(share) }))
    .toSorted((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let offset = 0; offset < remainingPoints; offset += 1) {
    const entry = priority[offset % priority.length];
    if (entry) roundedShares[entry.index] = (roundedShares[entry.index] ?? 0) + 1;
  }
  return roundedShares;
}

export function stableRankSignals(signals: RankSignal[] | undefined): RankSignal[] {
  return (signals ?? []).filter((signal) => signal.stable).slice(0, 3);
}

export function rankAnalysisAvailabilityText(
  analysis: Pick<RankAnalysis, "heldEventCount" | "matchCount" | "reasonCodes">,
): string {
  const reasons = new Set(analysis.reasonCodes ?? []);
  if (reasons.has("calculation_failed") || reasons.has("invalid_dataset")) {
    return "この条件では補助分析を計算できませんでした。ほかの戦績指標はそのまま確認できます。";
  }
  if (reasons.has("model_not_better")) {
    return "保存済み記録を加えても、番手などだけで比べる場合より読み取りが良くなりませんでした。";
  }
  if (reasons.has("unstable_signals")) {
    return "開催回ごとに結びつきの向きが変わるため、安定した手掛かりとしては表示しません。";
  }
  return `補助分析には32戦・8開催以上が必要です。現在は${analysis.matchCount}戦・${analysis.heldEventCount}開催です。`;
}
