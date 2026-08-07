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

export function rankSignalLabel(signal: string): string {
  return signalLabels[signal] ?? "保存済み記録";
}

export function rankSignalDirectionLabel(signal: RankSignal): string {
  const subject = rankSignalLabel(signal.signal);
  return signal.direction === "less_is_higher"
    ? `${subject}が少ない試合ほど上位寄り`
    : `${subject}が多い試合ほど上位寄り`;
}

export function rankSignalStrengthLabel(index: number): string {
  if (index === 0) return "最も強い";
  if (index === 1) return "次に強い";
  return "補助的";
}

export function stableRankSignals(signals: RankSignal[] | undefined): RankSignal[] {
  return (signals ?? []).filter((signal) => signal.stable).slice(0, 3);
}

export function rankAnalysisAvailabilityText(analysis: RankAnalysis): string {
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
