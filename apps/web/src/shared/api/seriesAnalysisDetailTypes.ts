import type { components, paths } from "@/shared/api/generated";

export type SeriesAnalysisQuery = {
  artifactId: string;
  gameTitleId: string;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
};

export type SeriesAnalysisDrilldownMetricId =
  paths["/api/analytics/series-comparison/v2/drilldown"]["get"]["parameters"]["query"]["metricId"];

export type SeriesAnalysisDrilldownQuery = SeriesAnalysisQuery & {
  memberId: string;
  metricId: SeriesAnalysisDrilldownMetricId;
};

export type SeriesAnalysisDrilldownV3 = components["schemas"]["SeriesAnalysisDrilldownResponse"];

export type SeriesAnalysisMatchContextQuery = SeriesAnalysisQuery & { matchId: string };

export type SeriesAnalysisMatchContextV2 =
  components["schemas"]["SeriesAnalysisMatchContextResponse"];
