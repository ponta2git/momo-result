import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type {
  SeriesAnalysisAdminOverview,
  SeriesAnalysisRecalculationAccepted,
} from "@/shared/api/seriesAnalysisAdminTypes";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysisAggregateTypes";
import type {
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisStatusResponse,
} from "@/shared/api/seriesAnalysisCoreTypes";
import type {
  SeriesAnalysisDrilldownQuery,
  SeriesAnalysisDrilldownV3,
  SeriesAnalysisMatchContextQuery,
  SeriesAnalysisMatchContextV2,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysisDetailTypes";
import type { SeriesComparisonReviewV3 } from "@/shared/api/seriesAnalysisReviewTypes";

export type * from "@/shared/api/seriesAnalysisCoreTypes";
export type * from "@/shared/api/seriesAnalysisAggregateTypes";
export type * from "@/shared/api/seriesAnalysisMetricTypes";
export type * from "@/shared/api/seriesAnalysisReviewTypes";
export type * from "@/shared/api/seriesAnalysisDetailTypes";
export type * from "@/shared/api/seriesAnalysisAdminTypes";

function scopedPath(resource: "aggregate" | "review", query: SeriesAnalysisQuery): string {
  const params = scopeParams(query);
  return `/api/analytics/series-comparison/v2/${resource}?${params.toString()}`;
}

function scopeParams(query: SeriesAnalysisQuery): URLSearchParams {
  const params = new URLSearchParams({
    artifactId: query.artifactId,
    gameTitleId: query.gameTitleId,
  });
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  if (query.mapMasterId) params.set("mapMasterId", query.mapMasterId);
  return params;
}

export function getSeriesAnalysisOptions(
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisOptionsResponse> {
  return apiRequest("/api/analytics/series-comparison/v2/options", options);
}

export function getSeriesAnalysisStatus(
  gameTitleId: string,
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisStatusResponse> {
  const params = new URLSearchParams({ gameTitleId });
  return apiRequest(`/api/analytics/series-comparison/v2/status?${params.toString()}`, options);
}

export function getSeriesAnalysisAggregate(
  query: SeriesAnalysisQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonAggregateV3> {
  return apiRequest(scopedPath("aggregate", query), options);
}

export function getSeriesAnalysisReview(
  query: SeriesAnalysisQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonReviewV3> {
  return apiRequest(scopedPath("review", query), options);
}

export function getSeriesAnalysisDrilldown(
  query: SeriesAnalysisDrilldownQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisDrilldownV3> {
  const params = scopeParams(query);
  params.set("memberId", query.memberId);
  params.set("metricId", query.metricId);
  return apiRequest(`/api/analytics/series-comparison/v2/drilldown?${params.toString()}`, options);
}

export function getSeriesAnalysisMatchContext(
  query: SeriesAnalysisMatchContextQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisMatchContextV2> {
  const params = scopeParams(query);
  params.set("matchId", query.matchId);
  return apiRequest(
    `/api/analytics/series-comparison/v2/match-context?${params.toString()}`,
    options,
  );
}

export function getSeriesAnalysisAdminOverview(
  gameTitleId: string | undefined,
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisAdminOverview> {
  const params = new URLSearchParams();
  if (gameTitleId) params.set("gameTitleId", gameTitleId);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return apiRequest(`/api/admin/series-analysis/overview${suffix}`, options);
}

export function requestSeriesAnalysisRecalculation(
  gameTitleId: string,
  options: IdempotencyRequestOptions,
): Promise<SeriesAnalysisRecalculationAccepted> {
  return apiRequest("/api/admin/series-analysis/recalculations", {
    body: { gameTitleId },
    idempotency: { key: options.idempotencyKey },
    method: "POST",
  });
}

export function requestAllSeriesAnalysisRecalculation(
  options: IdempotencyRequestOptions,
): Promise<SeriesAnalysisRecalculationAccepted> {
  return apiRequest("/api/admin/series-analysis/recalculations/all", {
    body: { confirmation: "all_titles" },
    idempotency: { key: options.idempotencyKey },
    method: "POST",
  });
}
