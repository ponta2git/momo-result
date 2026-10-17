import type {
  SeriesAnalysisOutlookExamples,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";

/** Read-only feature views borrow cache values without exposing their mutable API shape. */
type OutlookPeriod = Readonly<NonNullable<SeriesAnalysisOutlookSummary["period"]>>;
type OutlookHistoricalPerformance = Readonly<{
  averageRank: number;
  period: OutlookPeriod;
  rankSum: number;
  windowSize: number;
}>;
export type HistoricalOutlookExample = Readonly<{
  rankCounts: readonly [number, number, number, number];
  window: OutlookHistoricalPerformance;
}>;
export type OutlookHistoricalWindow = Readonly<{
  status: SeriesAnalysisOutlookExamples["examples"]["status"];
  window: OutlookHistoricalPerformance | null;
}>;
export type OutlookExamplesData = Readonly<{
  examples: Readonly<{
    status: SeriesAnalysisOutlookExamples["examples"]["status"];
    types: readonly HistoricalOutlookExample[];
  }>;
}>;
type OutlookReferenceResource<Data> = Readonly<{
  data: Data | undefined;
  hasError: boolean;
  refreshing: boolean;
  retry: () => Promise<void>;
}>;
export type OutlookReferenceResources = Readonly<{
  window: OutlookReferenceResource<OutlookHistoricalWindow>;
  examples: OutlookReferenceResource<OutlookExamplesData>;
}>;
