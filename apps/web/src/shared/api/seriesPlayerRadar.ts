import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";
import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

export type SeriesPlayerRadarState = components["schemas"]["SeriesPlayerRadarStateResponse"];
export type SeriesPlayerRadarPreview = components["schemas"]["SeriesPlayerRadarPreviewResponse"];
export type SeriesPlayerRadarOperation =
  components["schemas"]["SeriesPlayerRadarOperationResponse"];
export type SeriesPlayerRadarCommand = components["schemas"]["SeriesPlayerRadarOperationRequest"];
export type SeriesPlayerRadarBasisRecord = NonNullable<SeriesPlayerRadarState["currentBasis"]>;
export type SeriesPlayerRadarEvaluation = NonNullable<SeriesPlayerRadarPreview["after"]>;
export type SeriesAnalysisScopeStatus = components["schemas"]["SeriesAnalysisScopeStatusResponse"];

export type SeriesPlayerRadarPreviewQuery = {
  gameTitleId: string;
  previewId: string;
  seasonMasterId?: string | undefined;
  mapMasterId?: string | undefined;
};

export type SeriesAnalysisScopeStatusQuery = {
  gameTitleId: string;
  artifactId?: string | undefined;
  seasonMasterId?: string | undefined;
  mapMasterId?: string | undefined;
};

const validatorLoaders = {
  SeriesPlayerRadarStateResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"))
      .validateSeriesPlayerRadarStateResponse,
  SeriesPlayerRadarPreviewResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"))
      .validateSeriesPlayerRadarPreviewResponse,
  SeriesPlayerRadarOperationResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated"))
      .validateSeriesPlayerRadarOperationResponse,
  SeriesAnalysisScopeStatusResponse: async () =>
    (await import("@/shared/api/generatedContracts/series-analysis-envelope-validators.generated"))
      .validateSeriesAnalysisScopeStatusResponse,
};

function decode<T>(name: keyof typeof validatorLoaders, value: unknown): Promise<T> {
  return decodeSeriesAnalysisContract(`envelope:${name}`, name, validatorLoaders[name], value);
}

export function getSeriesPlayerRadarState(
  gameTitleId: string,
  options: ApiSignalOptions = {},
): Promise<SeriesPlayerRadarState> {
  const params = new URLSearchParams({ gameTitleId });
  return apiRequest(`/api/admin/series-analysis/radar?${params}`, {
    ...options,
    decodeResponse: (value) => decode("SeriesPlayerRadarStateResponse", value),
  });
}

export function getSeriesPlayerRadarPreview(
  query: SeriesPlayerRadarPreviewQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesPlayerRadarPreview> {
  const params = new URLSearchParams({
    gameTitleId: query.gameTitleId,
    previewId: query.previewId,
  });
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  if (query.mapMasterId) params.set("mapMasterId", query.mapMasterId);
  return apiRequest(`/api/admin/series-analysis/radar/preview?${params}`, {
    ...options,
    decodeResponse: (value) => decode("SeriesPlayerRadarPreviewResponse", value),
  });
}

export function getSeriesPlayerRadarOperation(
  gameTitleId: string,
  operationId: string,
  options: ApiSignalOptions = {},
): Promise<SeriesPlayerRadarOperation> {
  const params = new URLSearchParams({ gameTitleId, operationId });
  return apiRequest(`/api/admin/series-analysis/radar/operation?${params}`, {
    ...options,
    decodeResponse: (value) => decode("SeriesPlayerRadarOperationResponse", value),
  });
}

export function requestSeriesPlayerRadarOperation(
  command: SeriesPlayerRadarCommand,
  options: IdempotencyRequestOptions,
): Promise<SeriesPlayerRadarOperation> {
  return apiRequest("/api/admin/series-analysis/radar/operations", {
    body: command,
    method: "POST",
    idempotency: { key: options.idempotencyKey },
    decodeResponse: (value) => decode("SeriesPlayerRadarOperationResponse", value),
  });
}

export function getSeriesAnalysisScopeStatus(
  query: SeriesAnalysisScopeStatusQuery,
  options: ApiSignalOptions = {},
): Promise<SeriesAnalysisScopeStatus> {
  const params = new URLSearchParams({ gameTitleId: query.gameTitleId });
  if (query.artifactId) params.set("artifactId", query.artifactId);
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  if (query.mapMasterId) params.set("mapMasterId", query.mapMasterId);
  return apiRequest(`/api/analytics/series-comparison/v2/scope-status?${params}`, {
    ...options,
    decodeResponse: (value) => decode("SeriesAnalysisScopeStatusResponse", value),
  });
}

export function seriesPlayerRadarStateQueryOptions(gameTitleId: string | undefined) {
  return queryOptions({
    queryKey: seriesPlayerRadarKeys.state(gameTitleId),
    enabled: Boolean(gameTitleId),
    queryFn: ({ signal }) => {
      if (!gameTitleId) throw new Error("radar title is not ready");
      return getSeriesPlayerRadarState(gameTitleId, { signal });
    },
  });
}

export function seriesPlayerRadarPreviewQueryOptions(
  query: SeriesPlayerRadarPreviewQuery | undefined,
) {
  return queryOptions({
    queryKey: seriesPlayerRadarKeys.preview(query),
    enabled: Boolean(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("radar preview is not ready");
      return getSeriesPlayerRadarPreview(query, { signal });
    },
  });
}

export function seriesAnalysisScopeStatusQueryOptions(
  query: SeriesAnalysisScopeStatusQuery | undefined,
) {
  return queryOptions({
    queryKey: seriesPlayerRadarKeys.scopeStatus(query),
    enabled: Boolean(query),
    queryFn: ({ signal }) => {
      if (!query) throw new Error("series analysis scope is not ready");
      return getSeriesAnalysisScopeStatus(query, { signal });
    },
  });
}
