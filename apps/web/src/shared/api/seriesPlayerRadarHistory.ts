import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";
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
