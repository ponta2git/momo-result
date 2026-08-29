import type { components } from "@/shared/api/generated";

export type SeriesAnalysisArtifactResponseByKind = {
  aggregate: components["schemas"]["SeriesAnalysisAggregateResponse"];
  drilldown: components["schemas"]["SeriesAnalysisDrilldownResponse"];
  matchContext: components["schemas"]["SeriesAnalysisMatchContextResponse"];
  review: components["schemas"]["SeriesAnalysisReviewResponse"];
};

export const seriesAnalysisArtifactSchemaLoaders = {
  aggregate: async () =>
    (await import("./series-analysis-aggregate-response.schema.generated.json")).default,
  drilldown: async () =>
    (await import("./series-analysis-drilldown-response.schema.generated.json")).default,
  matchContext: async () =>
    (await import("./series-analysis-match-context-response.schema.generated.json")).default,
  review: async () =>
    (await import("./series-analysis-review-response.schema.generated.json")).default,
} satisfies Record<keyof SeriesAnalysisArtifactResponseByKind, () => Promise<unknown>>;
