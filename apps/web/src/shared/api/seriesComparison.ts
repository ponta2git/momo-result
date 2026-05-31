import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type SeriesComparisonOptionsResponse =
  components["schemas"]["SeriesComparisonOptionsResponse"];
export type SeriesComparisonResponse = components["schemas"]["SeriesComparisonResponse"];
export type SeriesComparisonScopeKind = "overall" | "season" | "map";

export type SeriesComparisonQuery = {
  gameTitleId: string;
  scopeKind: SeriesComparisonScopeKind;
  scopeId?: string | undefined;
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
    scopeKind: query.scopeKind,
  });
  if (query.scopeKind !== "overall" && query.scopeId) {
    params.set("scopeId", query.scopeId);
  }
  return `/api/analytics/series-comparison?${params.toString()}`;
}

export async function getSeriesComparison(
  query: SeriesComparisonQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesComparisonResponse> {
  return apiRequest<SeriesComparisonResponse>(buildSeriesComparisonPath(query), options);
}
