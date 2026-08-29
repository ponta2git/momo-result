import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type HeldEventDetailResponse = components["schemas"]["HeldEventDetailResponse"];
export type HeldEventMatchResponse = components["schemas"]["HeldEventMatchResponse"];
export type HeldEventDraftResponse = components["schemas"]["HeldEventDraftResponse"];
export type HeldEventPlayerResultResponse = components["schemas"]["HeldEventPlayerResultResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type DeleteHeldEventResponse = components["schemas"]["DeleteHeldEventResponse"];

export type ListHeldEventsQuery = {
  limit?: number;
  page?: number;
  pageSize?: number;
  q?: string;
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
  if (request.q?.trim()) {
    params.set("q", request.q.trim());
  }
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
