import { apiDownload } from "@/shared/api/client";
import type { ApiDownloadResult } from "@/shared/api/client";

import type { ExportMatchesRequest } from "./exportTypes";

export function buildExportMatchesPath(request: ExportMatchesRequest): string {
  const params = new URLSearchParams({ format: request.format });
  if (request.scope === "season" && request.seasonMasterId) {
    params.set("seasonMasterId", request.seasonMasterId);
  }
  if (request.scope === "heldEvent" && request.heldEventId) {
    params.set("heldEventId", request.heldEventId);
  }
  if (request.scope === "match" && request.matchId) {
    params.set("matchId", request.matchId);
  }
  return `/api/exports/matches?${params.toString()}`;
}

export async function exportMatches(
  request: ExportMatchesRequest,
  options: { signal?: AbortSignal } = {},
): Promise<ApiDownloadResult> {
  return apiDownload(buildExportMatchesPath(request), options);
}
