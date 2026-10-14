import type { SeriesComparisonAggregate as Aggregate } from "@/shared/api/seriesAnalysisAggregateTypes";

export type SeriesAnalysisMomentumRate = Aggregate["momentumSwitch"][number]["afterFourth"];
