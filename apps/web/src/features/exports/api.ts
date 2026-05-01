import { apiDownload } from "@/shared/api/client";
import type { ApiDownloadResult } from "@/shared/api/client";

export type ExportFormat = "csv" | "tsv";
export type ExportScope = "all" | "season" | "heldEvent" | "match";

export type ExportMatchesRequest = {
  format: ExportFormat;
  scope: ExportScope;
  seasonMasterId?: string;
  heldEventId?: string;
  matchId?: string;
};

export async function exportMatches(request: ExportMatchesRequest): Promise<ApiDownloadResult> {
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
  return apiDownload(`/api/exports/matches?${params.toString()}`);
}
