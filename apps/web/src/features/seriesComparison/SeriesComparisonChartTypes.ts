import type {
  PlayOrderHeatmapRow,
  RankDistributionBarEntry,
  RecentRankStripEntry,
  RevenueRankConversionEntry,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
export type TrendSeries = NonNullable<SeriesComparisonResponse["trends"]["rankCumulativeAverage"]>[number];
export type Histogram = SeriesComparisonResponse["histograms"]["assets"];
export type HistogramBin = NonNullable<Histogram["bins"]>[number];
export type HeadToHeadEntry = NonNullable<SeriesComparisonResponse["headToHead"]["entries"]>[number];
export type MatchPlayerPoint = NonNullable<SeriesComparisonResponse["matchPlayerPoints"]>[number];
export type PlayerPerformanceProfiles = SeriesComparisonResponse["playerPerformanceProfiles"];
export type {
  PlayOrderHeatmapRow,
  RankDistributionBarEntry,
  RecentRankStripEntry,
  RevenueRankConversionEntry,
};

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

