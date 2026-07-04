import type { SeriesComparisonDrilldownResponse } from "@/shared/api/seriesComparison";

export type PlayOrderTableView = "breakdown" | "trendData";
export type PlayOrderPayload = NonNullable<
  SeriesComparisonDrilldownResponse["playOrderRankHistory"]
>;
export type PlayOrderTrendRow = NonNullable<PlayOrderPayload["averageTrendRows"]>[number];
export type PlayOrderRow = NonNullable<PlayOrderPayload["playOrderRows"]>[number];
