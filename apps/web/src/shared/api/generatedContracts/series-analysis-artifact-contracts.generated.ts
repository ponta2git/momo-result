import type { components } from "@/shared/api/generated";
import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

export type SeriesAnalysisArtifactResponseByContract = {
  aggregateV4: components["schemas"]["SeriesAnalysisAggregateV4Response"];
  drilldown: components["schemas"]["SeriesAnalysisDrilldownResponse"];
  matchContext: components["schemas"]["SeriesAnalysisMatchContextResponse"];
  reviewV3: components["schemas"]["SeriesAnalysisReviewV3Response"];
};

export const seriesAnalysisArtifactValidatorLoaders = {
  aggregateV4: async () =>
    (await import("./series-analysis-aggregate-v4-validators.generated"))
      .validateSeriesAnalysisAggregateV4,
  drilldown: async () =>
    (await import("./series-analysis-drilldown-validators.generated"))
      .validateSeriesAnalysisDrilldown,
  matchContext: async () =>
    (await import("./series-analysis-match-context-validators.generated"))
      .validateSeriesAnalysisMatchContext,
  reviewV3: async () =>
    (await import("./series-analysis-review-v3-validators.generated"))
      .validateSeriesAnalysisReviewV3,
} satisfies Record<
  keyof SeriesAnalysisArtifactResponseByContract,
  () => Promise<ContractValidator>
>;
