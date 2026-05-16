import { apiRequest } from "@/shared/api/client";
import type { IdempotencyRequestOptions } from "@/shared/api/client";
import type { components } from "@/shared/api/generated";

export type HeldEventResponse = components["schemas"]["HeldEventResponse"];
export type HeldEventListResponse = components["schemas"]["HeldEventListResponse"];
export type CreateHeldEventRequest = components["schemas"]["CreateHeldEventRequest"];
export type DeleteHeldEventResponse = components["schemas"]["DeleteHeldEventResponse"];

export function upsertHeldEventList(
  current: HeldEventListResponse | undefined,
  event: HeldEventResponse,
): HeldEventListResponse {
  const existingItems = current?.items ?? [];
  const withoutDuplicate = existingItems.filter((item) => item.id !== event.id);
  return {
    items: [event, ...withoutDuplicate].toSorted(
      (left, right) =>
        new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime() ||
        right.id.localeCompare(left.id),
    ),
  };
}

export function removeHeldEventFromList(
  current: HeldEventListResponse | undefined,
  heldEventId: string,
): HeldEventListResponse {
  return {
    items: (current?.items ?? []).filter((item) => item.id !== heldEventId),
  };
}

export async function listHeldEvents(query = "", limit = 10): Promise<HeldEventListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) {
    params.set("q", query.trim());
  }
  return apiRequest<HeldEventListResponse>(`/api/held-events?${params.toString()}`);
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
