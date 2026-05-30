import { apiRequest } from "@/shared/api/client";
import type { ApiSignalOptions, IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type DeleteHeldEventResponse = components["schemas"]["DeleteHeldEventResponse"];

export type ListHeldEventsQuery = {
  limit?: number;
  page?: number;
  pageSize?: number;
  q?: string;
};

export async function listHeldEvents(
  query: ListHeldEventsQuery | string = "",
  limit = 10,
  options: ApiSignalOptions = {},
): Promise<HeldEventListResponse> {
  const request = typeof query === "string" ? { limit, q: query } : query;
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

export async function deleteHeldEvent(heldEventId: string): Promise<DeleteHeldEventResponse> {
  return apiRequest<DeleteHeldEventResponse>(
    `/api/held-events/${encodeURIComponent(heldEventId)}`,
    {
      method: "DELETE",
    },
  );
}
