import type { SeriesComparisonDrilldownResponse } from "@/shared/api/seriesComparison";

export type RankSignalsDrilldownPayload = NonNullable<
  SeriesComparisonDrilldownResponse["rankSignals"]
>;
export type RankSignalDetail = NonNullable<RankSignalsDrilldownPayload["signals"]>[number];
export type UnexpectedWinsDrilldownPayload = NonNullable<
  SeriesComparisonDrilldownResponse["unexpectedWins"]
>;
export type UnexpectedWinRow = NonNullable<UnexpectedWinsDrilldownPayload["rows"]>[number];
