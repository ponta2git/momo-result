import type {
  SeriesAnalysisDrilldownMetricId,
  SeriesComparisonAggregate,
} from "@/shared/api/seriesAnalysis";

export type SeriesAnalysisDrilldownSelection = {
  memberId: string;
  metricId: SeriesAnalysisDrilldownMetricId;
};

export type AnalysisViewProps = {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregate;
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
};
