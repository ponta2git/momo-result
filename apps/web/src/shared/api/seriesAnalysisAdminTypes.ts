import type { components } from "@/shared/api/generated";

export type SeriesAnalysisJobSummary = components["schemas"]["SeriesAnalysisJobSummaryResponse"];
export type SeriesAnalysisJobStatus = SeriesAnalysisJobSummary["status"];
export type SeriesAnalysisTrigger = SeriesAnalysisJobSummary["trigger"];
export type SeriesAnalysisResultDisposition = SeriesAnalysisJobSummary["resultDisposition"];
export type SeriesAnalysisSafeFailureCode = NonNullable<
  SeriesAnalysisJobSummary["safeFailureCode"]
>;
export type SeriesAnalysisAdminOverview =
  components["schemas"]["SeriesAnalysisAdminOverviewResponse"];
export type SeriesAnalysisRecalculationAccepted =
  components["schemas"]["SeriesAnalysisRecalculationAcceptedResponse"];
