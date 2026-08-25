import type { SeriesAnalysisDrilldownMetricId } from "@/shared/api/seriesAnalysis";

export function drilldownTitle(metricId: SeriesAnalysisDrilldownMetricId): string {
  switch (metricId) {
    case "rank.averageHistory":
      return "平均順位の推移";
    case "playOrder.rankHistory":
      return "番手別順位の推移";
    case "rankAnalysis.rankSignals":
      return "順位を読む手掛かり";
    case "rankAnalysis.unexpectedWins":
      return "予測より上位だった勝利";
  }
}
