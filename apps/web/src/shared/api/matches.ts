import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type MatchSummaryResponse = components["schemas"]["MatchSummaryResponse"];
export type MatchListResponse = components["schemas"]["MatchListResponse"];
export type MatchListSummaryResponse = components["schemas"]["MatchListSummaryResponse"];
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
  page?: number;
  pageSize?: number;
  sort?: "status_priority" | "updated_desc" | "held_desc" | "held_asc" | "match_no_asc";
};

export async function listMatches(
  query: ListMatchesQuery = {},
  options: ApiSignalOptions = {},
): Promise<MatchListResponse> {
  const params = new URLSearchParams();
  if (query.heldEventId) params.set("heldEventId", query.heldEventId);
  if (query.gameTitleId) params.set("gameTitleId", query.gameTitleId);
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  if (query.status) params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.sort) params.set("sort", query.sort);
  const qs = params.toString();
  return apiRequest<MatchListResponse>(`/api/matches${qs ? `?${qs}` : ""}`, options);
}

export async function getMatchListSummary(
  query: Pick<ListMatchesQuery, "gameTitleId" | "heldEventId" | "seasonMasterId"> = {},
  options: ApiSignalOptions = {},
): Promise<MatchListSummaryResponse> {
  const params = new URLSearchParams();
  if (query.heldEventId) params.set("heldEventId", query.heldEventId);
  if (query.gameTitleId) params.set("gameTitleId", query.gameTitleId);
  if (query.seasonMasterId) params.set("seasonMasterId", query.seasonMasterId);
  const qs = params.toString();
  return apiRequest<MatchListSummaryResponse>(`/api/matches/summary${qs ? `?${qs}` : ""}`, options);
}

export async function getMatch(
  matchId: string,
  options: ApiSignalOptions = {},
): Promise<MatchDetailResponse> {
  return apiRequest<MatchDetailResponse>(`/api/matches/${encodeURIComponent(matchId)}`, options);
}

export async function updateMatch(
  matchId: string,
  request: UpdateMatchRequest,
  options: IdempotencyRequestOptions,
): Promise<MatchDetailResponse> {
  return apiRequest<MatchDetailResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}

export async function deleteMatch(
  matchId: string,
  options: IdempotencyRequestOptions,
): Promise<DeleteMatchResponse> {
  return apiRequest<DeleteMatchResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "DELETE",
    idempotency: { key: options.idempotencyKey },
  });
}

export async function confirmMatch(
  request: ConfirmMatchRequest,
  options: IdempotencyRequestOptions,
): Promise<ConfirmMatchResponse> {
  return apiRequest<ConfirmMatchResponse>("/api/matches", {
    method: "POST",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}
