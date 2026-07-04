import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type MetricsEntry = NonNullable<SeriesComparisonResponse["metricsByPlayer"]>[number];
export type PlayerMetrics = MetricsEntry["metrics"];
export type RecentFormEntry = NonNullable<SeriesComparisonResponse["recentFormByPlayer"]>[number];
export type MomentumSwitchEntry = NonNullable<
  SeriesComparisonResponse["momentumSwitch"]["entries"]
>[number];
export type MomentumSwitchRateKey = "afterFourth" | "afterLower" | "afterPodium";
export type PerformanceProfileEntry = NonNullable<
  SeriesComparisonResponse["playerPerformanceProfiles"]["entries"]
>[number];
export type AssetStyleProfileEntry = NonNullable<
  SeriesComparisonResponse["assetStyleProfiles"]["entries"]
>[number];
export type AssetStyleEvidenceItem = {
  emphasis?: MetricEmphasis | undefined;
  help?: string | undefined;
  key: string;
  label: string;
  value: string;
};
export type MatchNoBreakdown = NonNullable<
  SeriesComparisonResponse["matchNoInEventBreakdown"]
>[number];
export type MatchPlayerPoint = NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number];
export type CardShopDestinationEntry = NonNullable<
  SeriesComparisonResponse["cardShopDestination"]["entries"]
>[number];
export type CardShopDestinationQuadrant = NonNullable<
  CardShopDestinationEntry["quadrants"]
>[number];
export type MetricEmphasis = {
  kind: "evidence" | "leader" | "risk" | "strength";
  label: string;
};
export type RecentRankStripEntry = {
  memberId: string;
  points: Array<{
    matchId: string;
    matchIndex: number;
    rank: number;
  }>;
  status: string;
  targetCount: number;
  totalCount: number;
  windowSize: number;
};
export type RankDistributionBarEntry = {
  memberId: string;
  segments: Array<{
    count: number;
    rank: number;
    rate: number | undefined;
  }>;
  totalCount: number;
};
export type PlayOrderHeatmapRow = {
  cells: Array<{
    matchCount: number;
    playOrder: number;
    rankAverage: number | undefined;
  }>;
  memberId: string;
};
export type RevenueRankConversionEntry = {
  memberId: string;
  rows: Array<{
    finalRankCounts: Array<{
      count: number;
      rank: number;
      rate: number | undefined;
    }>;
    revenueRank: number;
    targetCount: number;
  }>;
};
export type NullableNumber = number | null | undefined;
export type NumericExtrema = {
  max: number | undefined;
  min: number | undefined;
};
