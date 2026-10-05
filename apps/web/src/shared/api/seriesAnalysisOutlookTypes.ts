import type { components, paths } from "@/shared/api/generated";

export type SeriesAnalysisOutlookSummary =
  components["schemas"]["SeriesAnalysisOutlookSummaryResponse"];
export type SeriesAnalysisOutlookWindow =
  components["schemas"]["SeriesAnalysisOutlookWindowResponse"];
export type SeriesAnalysisOutlookExamples =
  components["schemas"]["SeriesAnalysisOutlookExamplesResponse"];

type SummaryQuery =
  paths["/api/analytics/series-comparison/v1/outlook-summary"]["get"]["parameters"]["query"];
export type SeriesAnalysisOutlookSummaryQuery = Omit<SummaryQuery, "seasonMasterId"> & {
  seasonMasterId?: string | undefined;
};
export type SeriesAnalysisOutlookWindowQuery =
  paths["/api/analytics/series-comparison/v1/outlook-window"]["get"]["parameters"]["query"];
export type SeriesAnalysisOutlookExamplesQuery =
  paths["/api/analytics/series-comparison/v1/outlook-examples"]["get"]["parameters"]["query"];
