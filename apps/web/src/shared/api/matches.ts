import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type MatchSummaryResponse = components["schemas"]["MatchSummaryResponse"];
export type MatchListResponse = components["schemas"]["MatchListResponse"];
export type MatchListSummaryResponse = components["schemas"]["MatchListSummaryResponse"];
export type MatchIdentityResponse = components["schemas"]["MatchIdentityResponse"];
export type MatchDetailResponse = components["schemas"]["MatchDetailResponse"];
export type UpdateMatchRequest = components["schemas"]["UpdateMatchRequest"];
export type UpdateMatchResponse = components["schemas"]["UpdateMatchResponse"];
export type ReplaceMatchNoteRequest = components["schemas"]["ReplaceMatchNoteRequest"];
export type ReplaceMatchNoteResponse = components["schemas"]["ReplaceMatchNoteResponse"];
export type DeleteMatchResponse = components["schemas"]["DeleteMatchResponse"];
export type ConfirmMatchRequest = components["schemas"]["ConfirmMatchRequest"];
export type ConfirmMatchResponse = components["schemas"]["ConfirmMatchResponse"];

export type ListMatchesQuery = {
  heldEventId?: string;
  gameTitleId?: string;
  seasonMasterId?: string;
  status?: "all" | "confirmed" | "incomplete" | "needs_review" | "ocr_running" | "pre_confirm";
  kind?: "match" | "match_draft";
  pageSize?: number;
  cursor?: string;
  sort?: "status_priority" | "updated_desc" | "held_desc" | "held_asc" | "match_no_asc";
  /** Confirmed-match search criteria; the API accepts them only with `kind: "match"`. */
  mapMasterId?: string;
  from?: string;
  to?: string;
  q?: string;
  memberId?: string;
  record?:
    | "destination"
    | "plus_station"
    | "minus_station"
    | "card_station"
    | "card_shop"
    | "suri_no_ginji"
    | "total_assets"
    | "revenue";
  recordValue?: number;
  recordRange?: "gte" | "lte";
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
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.sort) params.set("sort", query.sort);
  if (query.mapMasterId) params.set("mapMasterId", query.mapMasterId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.q) params.set("q", query.q);
  if (query.memberId) params.set("memberId", query.memberId);
  if (query.record) params.set("record", query.record);
  if (query.recordValue !== undefined) params.set("recordValue", String(query.recordValue));
  if (query.recordRange) params.set("recordRange", query.recordRange);
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
  const response = await apiRequest<MatchDetailResponse>(
    `/api/matches/${encodeURIComponent(matchId)}`,
    options,
  );
  return response.note ? response : { ...response, note: { version: "0" } };
}

export function getMatchByPublicId(publicId: string, options: ApiSignalOptions = {}) {
  return apiRequest<MatchDetailResponse>(
    `/api/public/matches/${encodeURIComponent(publicId)}`,
    options,
  );
}

export async function updateMatch(
  matchId: string,
  request: UpdateMatchRequest,
  options: IdempotencyRequestOptions,
): Promise<UpdateMatchResponse> {
  return apiRequest<UpdateMatchResponse>(`/api/matches/${encodeURIComponent(matchId)}`, {
    method: "PUT",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}

export async function replaceMatchNote(
  matchId: string,
  request: ReplaceMatchNoteRequest,
  options: IdempotencyRequestOptions,
): Promise<ReplaceMatchNoteResponse> {
  return apiRequest<ReplaceMatchNoteResponse>(`/api/matches/${encodeURIComponent(matchId)}/note`, {
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

export function getMatchIdentity(matchId: string, options: ApiSignalOptions = {}) {
  return apiRequest<MatchIdentityResponse>(
    `/api/matches/${encodeURIComponent(matchId)}/identity`,
    options,
  );
}
