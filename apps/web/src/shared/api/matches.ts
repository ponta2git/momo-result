import { apiRequest } from "@/shared/api/client";
import type { IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type MatchSummaryResponse = components["schemas"]["MatchSummaryResponse"];
export type MatchListResponse = components["schemas"]["MatchListResponse"];
export type MatchDetailResponse = components["schemas"]["MatchDetailResponse"];
export type UpdateMatchRequest = components["schemas"]["UpdateMatchRequest"];
export type DeleteMatchResponse = components["schemas"]["DeleteMatchResponse"];
export type ConfirmMatchRequest = components["schemas"]["ConfirmMatchRequest"];
export type ConfirmMatchResponse = components["schemas"]["ConfirmMatchResponse"];

export type ListMatchesQuery = {
  heldEventId?: string;
  gameTitleId?: string;
  seasonMasterId?: string;
  status?: "all" | "confirmed" | "incomplete" | "needs_review" | "ocr_running" | "pre_confirm";
  kind?: "match" | "match_draft";
  limit?: number;
};

export async function listMatches(query: ListMatchesQuery = {}): Promise<MatchListResponse> {
  const params = new URLSearchParams();
  if (query.heldEventId) params.set("heldEventId", query.heldEventId);
  if (query.gameTitleId) params.set("gameTitleId", query.gameTitleId);
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  if (query.status) params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiRequest<MatchListResponse>(`/api/matches${qs ? `?${qs}` : ""}`);
}

export async function getMatch(matchId: string): Promise<MatchDetailResponse> {
  return apiRequest<MatchDetailResponse>(`/api/matches/${encodeURIComponent(matchId)}`);
}

export async function updateMatch(
  matchId: string,
  request: UpdateMatchRequest,
): Promise<MatchDetailResponse> {
  return apiRequest<MatchDetailResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "PUT",
    body: request,
  });
}

export async function deleteMatch(matchId: string): Promise<DeleteMatchResponse> {
  return apiRequest<DeleteMatchResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "DELETE",
  });
}

export async function confirmMatch(
  request: ConfirmMatchRequest,
  options: IdempotencyRequestOptions = {},
): Promise<ConfirmMatchResponse> {
  return apiRequest<ConfirmMatchResponse>("/api/matches", {
    method: "POST",
    body: request,
    idempotency: options.idempotencyKey ? { key: options.idempotencyKey } : "auto",
  });
}
