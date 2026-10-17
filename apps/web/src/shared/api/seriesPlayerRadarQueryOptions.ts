import { queryOptions } from "@tanstack/react-query";

import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import {
  getSeriesPlayerRadarState,
  getSeriesPlayerRadarPreview,
  getSeriesPlayerRadarOperation,
  getSeriesAnalysisScopeStatus,
} from "@/shared/api/seriesPlayerRadar";
import type {
  SeriesPlayerRadarPreviewQuery,
  SeriesAnalysisScopeStatusQuery,
} from "@/shared/api/seriesPlayerRadar";
import {
  getPlayerRadarHistory,
  getPlayerRadarRevision,
} from "@/shared/api/seriesPlayerRadarHistory";
import type { PlayerRadarHistoryQuery } from "@/shared/api/seriesPlayerRadarHistory";

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

export function seriesPlayerRadarOperationQueryOptions(gameTitleId: string, operationId: string) {
  return queryOptions({
    queryKey: seriesPlayerRadarKeys.operation(gameTitleId, operationId),
    queryFn: ({ signal }) => getSeriesPlayerRadarOperation(gameTitleId, operationId, { signal }),
    staleTime: 0,
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

export function playerRadarHistoryQueryOptions(query: PlayerRadarHistoryQuery) {
  return queryOptions({
    queryKey: [...seriesPlayerRadarKeys.all(), "revisions-v1", query] as const,
    queryFn: ({ signal }) => getPlayerRadarHistory(query, { signal }),
    staleTime: 0,
    placeholderData: () => undefined,
  });
}

export function playerRadarRevisionQueryOptions(revisionId: string | undefined) {
  return queryOptions({
    queryKey: [...seriesPlayerRadarKeys.all(), "revision-v1", revisionId] as const,
    queryFn: ({ signal }) => {
      if (!revisionId) throw new Error("radar revision is not selected");
      return getPlayerRadarRevision(revisionId, { signal });
    },
    placeholderData: () => undefined,
  });
}
