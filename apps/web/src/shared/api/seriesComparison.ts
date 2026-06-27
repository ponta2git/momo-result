import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type SeriesComparisonOptionsResponse =
  components["schemas"]["SeriesComparisonOptionsResponse"];
export type SeriesComparisonResponse = components["schemas"]["SeriesComparisonResponse"];
export type SeriesComparisonReviewResponse =
  components["schemas"]["SeriesComparisonReviewResponse"];
export type SeriesComparisonDrilldownResponse =
  components["schemas"]["SeriesComparisonDrilldownResponse"];

export type SeriesComparisonQuery = {
  gameTitleId: string;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
};

export type SeriesComparisonReviewQuery = SeriesComparisonQuery;

export type SeriesComparisonDrilldownQuery = SeriesComparisonQuery & {
  memberId: string;
  metricId: "playOrder.rankHistory" | "rank.averageHistory";
};

export async function getSeriesComparisonOptions(
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonOptionsResponse> {
  return apiRequest<SeriesComparisonOptionsResponse>(
    "/api/analytics/series-comparison/options",
    options,
  );
}

export function buildSeriesComparisonPath(query: SeriesComparisonQuery): string {
  const params = new URLSearchParams({
    gameTitleId: query.gameTitleId,
  });
  if (query.seasonMasterId) {
    params.set("seasonMasterId", query.seasonMasterId);
  }
  if (query.mapMasterId) {
    params.set("mapMasterId", query.mapMasterId);
  }
  return `/api/analytics/series-comparison?${params.toString()}`;
}

export function buildSeriesComparisonReviewPath(query: SeriesComparisonReviewQuery): string {
  const params = new URLSearchParams({
    gameTitleId: query.gameTitleId,
  });
  if (query.seasonMasterId) {
    params.set("seasonMasterId", query.seasonMasterId);
  }
  if (query.mapMasterId) {
    params.set("mapMasterId", query.mapMasterId);
  }
  return `/api/analytics/series-comparison/review?${params.toString()}`;
}

export function buildSeriesComparisonDrilldownPath(query: SeriesComparisonDrilldownQuery): string {
  const params = new URLSearchParams({
    gameTitleId: query.gameTitleId,
    memberId: query.memberId,
    metricId: query.metricId,
  });
  if (query.seasonMasterId) {
    params.set("seasonMasterId", query.seasonMasterId);
  }
  if (query.mapMasterId) {
    params.set("mapMasterId", query.mapMasterId);
  }
  return `/api/analytics/series-comparison/drilldown?${params.toString()}`;
}

export async function getSeriesComparison(
  query: SeriesComparisonQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonResponse> {
  return apiRequest<SeriesComparisonResponse>(buildSeriesComparisonPath(query), options);
}

export async function getSeriesComparisonReview(
  query: SeriesComparisonReviewQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonReviewResponse> {
  return apiRequest<SeriesComparisonReviewResponse>(
    buildSeriesComparisonReviewPath(query),
    options,
  );
}

export async function getSeriesComparisonDrilldown(
  query: SeriesComparisonDrilldownQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonDrilldownResponse> {
  return apiRequest<SeriesComparisonDrilldownResponse>(
    buildSeriesComparisonDrilldownPath(query),
    options,
  );
}
