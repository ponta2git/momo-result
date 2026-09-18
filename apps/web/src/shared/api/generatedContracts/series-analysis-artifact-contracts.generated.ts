import type { components } from "@/shared/api/generated";
import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

export type SeriesAnalysisArtifactResponseByContract = {
  aggregateV2: components["schemas"]["SeriesAnalysisAggregateResponse"];
  aggregateV3: components["schemas"]["SeriesAnalysisAggregateV3Response"];
  drilldown: components["schemas"]["SeriesAnalysisDrilldownResponse"];
  matchContext: components["schemas"]["SeriesAnalysisMatchContextResponse"];
  review: components["schemas"]["SeriesAnalysisReviewResponse"];
};

export const seriesAnalysisArtifactValidatorLoaders = {
  aggregateV2: async () =>
    (await import("./series-analysis-aggregate-v2-validators.generated"))
      .validateSeriesAnalysisAggregateV2,
  aggregateV3: async () =>
    (await import("./series-analysis-aggregate-v3-validators.generated"))
      .validateSeriesAnalysisAggregateV3,
  drilldown: async () =>
    (await import("./series-analysis-drilldown-validators.generated"))
      .validateSeriesAnalysisDrilldown,
  matchContext: async () =>
    (await import("./series-analysis-match-context-validators.generated"))
      .validateSeriesAnalysisMatchContext,
  review: async () =>
    (await import("./series-analysis-review-validators.generated")).validateSeriesAnalysisReview,
} satisfies Record<
  keyof SeriesAnalysisArtifactResponseByContract,
  () => Promise<ContractValidator>
>;
