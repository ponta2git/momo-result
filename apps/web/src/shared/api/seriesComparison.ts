import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type SeriesComparisonOptionsResponse =
  components["schemas"]["SeriesComparisonOptionsResponse"];
export type SeriesComparisonResponse = components["schemas"]["SeriesComparisonResponse"];

export type SeriesComparisonQuery = {
  gameTitleId: string;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
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

export async function getSeriesComparison(
  query: SeriesComparisonQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonResponse> {
  return apiRequest<SeriesComparisonResponse>(buildSeriesComparisonPath(query), options);
}
