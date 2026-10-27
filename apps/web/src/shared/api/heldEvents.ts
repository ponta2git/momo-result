import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type HeldEventListItemResponse = components["schemas"]["HeldEventListItemResponse"];
export type HeldEventListPlayerResultResponse =
  components["schemas"]["HeldEventListPlayerResultResponse"];
export type HeldEventNoteMatchResponse = components["schemas"]["HeldEventNoteMatchResponse"];
export type HeldEventSummaryResponse = components["schemas"]["HeldEventSummaryResponse"];
export type HeldEventDetailResponse = components["schemas"]["HeldEventDetailResponse"];
export type HeldEventMatchResponse = components["schemas"]["HeldEventMatchResponse"];
export type HeldEventDraftResponse = components["schemas"]["HeldEventDraftResponse"];
export type HeldEventPlayerResultResponse = components["schemas"]["HeldEventPlayerResultResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type DeleteHeldEventResponse = components["schemas"]["DeleteHeldEventResponse"];

export type ListHeldEventsSort = "held_desc" | "held_asc";
export type ListHeldEventsMetric =
  | "average_rank"
  | "rank1_count"
  | "rank2_count"
  | "rank3_count"
  | "rank4_count";

export type ListHeldEventsQuery = {
  limit?: number;
  page?: number;
  pageSize?: number;
  sort?: ListHeldEventsSort;
  /** Search criteria evaluated over each held event's confirmed matches. */
  gameTitleId?: string;
  seasonMasterId?: string;
  mapMasterId?: string;
  from?: string;
  to?: string;
  minMatchCount?: number;
  /** Match-note phrase; items then carry `noteMatch`. */
  q?: string;
  memberId?: string;
  metric?: ListHeldEventsMetric;
  /** `average_rank`: "1.00"–"4.00" with at most 2 decimals; counts: integer string ≥ 0. */
  metricValue?: string;
  metricRange?: "gte" | "lte";
};

export async function listHeldEvents(
  query: ListHeldEventsQuery | undefined = undefined,
  options: ApiSignalOptions = {},
): Promise<HeldEventListResponse> {
  const request = query ?? { limit: 10 };
  const params = new URLSearchParams();
  if (request.limit !== undefined) params.set("limit", String(request.limit));
  if (request.page !== undefined) params.set("page", String(request.page));
  if (request.pageSize !== undefined) params.set("pageSize", String(request.pageSize));
  if (request.sort) params.set("sort", request.sort);
  if (request.gameTitleId) params.set("gameTitleId", request.gameTitleId);
  if (request.seasonMasterId) params.set("seasonMasterId", request.seasonMasterId);
  if (request.mapMasterId) params.set("mapMasterId", request.mapMasterId);
  if (request.from) params.set("from", request.from);
  if (request.to) params.set("to", request.to);
  if (request.minMatchCount !== undefined) {
    params.set("minMatchCount", String(request.minMatchCount));
  }
  if (request.q?.trim()) {
    params.set("q", request.q.trim());
  }
  if (request.memberId) params.set("memberId", request.memberId);
  if (request.metric) params.set("metric", request.metric);
  if (request.metricValue) params.set("metricValue", request.metricValue);
  if (request.metricRange) params.set("metricRange", request.metricRange);
  return apiRequest<HeldEventListResponse>(`/api/held-events?${params.toString()}`, options);
}

export async function createHeldEvent(
  request: CreateHeldEventRequest,
  options: IdempotencyRequestOptions,
): Promise<HeldEventResponse> {
  return apiRequest<HeldEventResponse>("/api/held-events", {
    method: "POST",
    body: request,
    idempotency: { key: options.idempotencyKey },
  });
}

export async function getHeldEventDetail(
  heldEventId: string,
  options: ApiSignalOptions = {},
): Promise<HeldEventDetailResponse> {
  return apiRequest<HeldEventDetailResponse>(
    `/api/held-events/${encodeURIComponent(heldEventId)}`,
    options,
  );
}

export function getHeldEventByPublicId(publicId: string, options: ApiSignalOptions = {}) {
  return apiRequest<HeldEventDetailResponse>(
    `/api/public/held-events/${encodeURIComponent(publicId)}`,
    options,
  );
}

export async function deleteHeldEvent(
  heldEventId: string,
  options: IdempotencyRequestOptions,
): Promise<DeleteHeldEventResponse> {
  return apiRequest<DeleteHeldEventResponse>(
    `/api/held-events/${encodeURIComponent(heldEventId)}`,
    {
      method: "DELETE",
      idempotency: { key: options.idempotencyKey },
    },
  );
}

export function getHeldEventSummary(heldEventId: string, options: ApiSignalOptions = {}) {
  return apiRequest<HeldEventSummaryResponse>(
    `/api/held-events/${encodeURIComponent(heldEventId)}/summary`,
    options,
  );
}
