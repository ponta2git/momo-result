import type { SeriesComparisonDrilldownResponse } from "@/shared/api/seriesComparison";

export type RankDrilldownView = "events" | "matches";
export type RankAverageHistoryPayload = NonNullable<
  SeriesComparisonDrilldownResponse["rankAverageHistory"]
>;
export type RankMatchRow = NonNullable<RankAverageHistoryPayload["matchRows"]>[number];
export type RankEventRow = NonNullable<RankAverageHistoryPayload["heldEventRows"]>[number];
