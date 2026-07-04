import { apiDownload } from "@/shared/api/client";
import type { ApiDownloadResult } from "@/shared/api/client";
import type { operations } from "@/shared/api/generated";

type ExportMatchesQuery = operations["getApiExportsMatches"]["parameters"]["query"];

export type ExportMatchesFormat = "csv" | "tsv";
export type ExportMatchesScope = "all" | "season" | "heldEvent" | "match";

export type ExportMatchesRequest = {
  format: ExportMatchesFormat;
  heldEventId?: string | undefined;
  matchId?: string | undefined;
  scope: ExportMatchesScope;
  seasonMasterId?: string | undefined;
};

function activeExportMatchesQuery(request: ExportMatchesRequest): ExportMatchesQuery {
  const query: ExportMatchesQuery = { format: request.format };
  if (request.scope === "season" && request.seasonMasterId) {
    query.seasonMasterId = request.seasonMasterId;
  }
  if (request.scope === "heldEvent" && request.heldEventId) {
    query.heldEventId = request.heldEventId;
  }
  if (request.scope === "match" && request.matchId) {
    query.matchId = request.matchId;
  }
  return query;
}

export function buildExportMatchesPath(request: ExportMatchesRequest): string {
  const query = activeExportMatchesQuery(request);
  const params = new URLSearchParams({ format: query.format });
  if (query.seasonMasterId) {
    params.set("seasonMasterId", query.seasonMasterId);
  }
  if (query.heldEventId) {
    params.set("heldEventId", query.heldEventId);
  }
  if (query.matchId) {
    params.set("matchId", query.matchId);
  }
  return `/api/exports/matches?${params.toString()}`;
}

export async function exportMatches(
  request: ExportMatchesRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ApiDownloadResult> {
  return apiDownload(buildExportMatchesPath(request), options);
}
