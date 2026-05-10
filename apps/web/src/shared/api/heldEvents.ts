import { apiRequest } from "@/shared/api/client";
import type { IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type DeleteHeldEventResponse = components["schemas"]["DeleteHeldEventResponse"];

export async function listHeldEvents(query = "", limit = 10): Promise<HeldEventListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return apiRequest<HeldEventListResponse>(`/api/held-events?${params.toString()}`);
}

export async function createHeldEvent(
  request: CreateHeldEventRequest,
  options: IdempotencyRequestOptions = {},
): Promise<HeldEventResponse> {
  return apiRequest<HeldEventResponse>("/api/held-events", {
    method: "POST",
    body: request,
    idempotencyKey: options.idempotencyKey,
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
