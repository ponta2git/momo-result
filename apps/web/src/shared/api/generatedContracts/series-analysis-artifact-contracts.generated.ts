import type { components } from "@/shared/api/generated";
import type { ContractValidator } from "@/shared/api/seriesAnalysisContractDecoder";

export type SeriesAnalysisArtifactResponseByKind = {
  aggregate: components["schemas"]["SeriesAnalysisAggregateResponse"];
  drilldown: components["schemas"]["SeriesAnalysisDrilldownResponse"];
  matchContext: components["schemas"]["SeriesAnalysisMatchContextResponse"];
  review: components["schemas"]["SeriesAnalysisReviewResponse"];
};

export const seriesAnalysisArtifactValidatorLoaders = {
  aggregate: async () =>
    (await import("./series-analysis-validators.generated")).validateSeriesAnalysisAggregate,
  drilldown: async () =>
    (await import("./series-analysis-validators.generated")).validateSeriesAnalysisDrilldown,
  matchContext: async () =>
    (await import("./series-analysis-validators.generated")).validateSeriesAnalysisMatchContext,
  review: async () =>
    (await import("./series-analysis-validators.generated")).validateSeriesAnalysisReview,
} satisfies Record<keyof SeriesAnalysisArtifactResponseByKind, () => Promise<ContractValidator>>;
