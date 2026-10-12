import { queryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";
import { seriesPlayerRadarKeys } from "@/shared/api/queryKeys";
import { decodeSeriesAnalysisContract } from "@/shared/api/seriesAnalysisContractDecoder";

export type PlayerRadarRevision = components["schemas"]["SeriesPlayerRadarRevisionResponse"];
export type PlayerRadarRevisionList =
  components["schemas"]["SeriesPlayerRadarRevisionListResponse"];
export type PlayerRadarRevisionDetail =
  components["schemas"]["SeriesPlayerRadarRevisionDetailResponse"];
export type PlayerRadarHistoryQuery = {
  gameTitleId?: string | undefined;
  cursor?: string | undefined;
};

export function getPlayerRadarHistory(
  query: PlayerRadarHistoryQuery,
  options: ApiSignalOptions = {},
): Promise<PlayerRadarRevisionList> {
  const params = new URLSearchParams({ limit: "20" });
  if (query.gameTitleId) params.set("gameTitleId", query.gameTitleId);
  if (query.cursor) params.set("cursor", query.cursor);
  return apiRequest(`/api/admin/series-analysis/radar/revisions?${params}`, {
    ...options,
    decodeResponse: (value) =>
      decodeSeriesAnalysisContract(
        "envelope:SeriesPlayerRadarRevisionListResponse",
        "SeriesPlayerRadarRevisionListResponse",
        async () =>
          (
            await import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated")
          ).validateSeriesPlayerRadarRevisionListResponse,
        value,
      ),
  });
}

export function getPlayerRadarRevision(
  revisionId: string,
  options: ApiSignalOptions = {},
): Promise<PlayerRadarRevisionDetail> {
  return apiRequest(
    `/api/admin/series-analysis/radar/revisions/${encodeURIComponent(revisionId)}`,
    {
      ...options,
      decodeResponse: (value) =>
        decodeSeriesAnalysisContract(
          "envelope:SeriesPlayerRadarRevisionDetailResponse",
          "SeriesPlayerRadarRevisionDetailResponse",
          async () =>
            (
              await import("@/shared/api/generatedContracts/series-analysis-radar-validators.generated")
            ).validateSeriesPlayerRadarRevisionDetailResponse,
          value,
        ),
    },
  );
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
