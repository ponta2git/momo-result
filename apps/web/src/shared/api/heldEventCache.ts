import type { QueryClient } from "@tanstack/react-query";

import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";

export function mergeHeldEventItems(
  heldEvents: HeldEventResponse[],
  preferred: HeldEventResponse | undefined,
): HeldEventResponse[] {
  return preferred && !heldEvents.some((event) => event.id === preferred.id)
    ? [preferred, ...heldEvents]
    : heldEvents;
}

export function upsertHeldEventList(
  current: Partial<HeldEventListResponse> | undefined,
  event: HeldEventResponse,
): HeldEventListResponse {
  const existingItems = current?.items ?? [];
  const withoutDuplicate = existingItems.filter((item) => item.id !== event.id);
  const items = [event, ...withoutDuplicate].toSorted(
    (left, right) =>
      new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime() ||
      right.id.localeCompare(left.id),
  );
  return {
    items,
    pagination: current?.pagination ?? fallbackPagination(items.length),
    totalMatchCount: current?.totalMatchCount ?? totalMatches(items),
  };
}

export function removeHeldEventFromList(
  current: Partial<HeldEventListResponse> | undefined,
  heldEventId: string,
): HeldEventListResponse {
  const items = (current?.items ?? []).filter((item) => item.id !== heldEventId);
  return {
    items,
    pagination: current?.pagination ?? fallbackPagination(items.length),
    totalMatchCount: current?.totalMatchCount ?? totalMatches(items),
  };
}

function fallbackPagination(totalItems: number): HeldEventListResponse["pagination"] {
  return {
    hasNextPage: false,
    hasPreviousPage: false,
    page: 1,
    pageSize: Math.max(totalItems, 1),
    totalItems,
    totalPages: totalItems === 0 ? 0 : 1,
  };
}

function totalMatches(items: HeldEventResponse[]): number {
  return items.reduce((sum, item) => sum + item.matchCount, 0);
}

/** Upserts the shared directory; paginated list membership remains server-owned and is invalidated. */
export async function syncHeldEventCreatedCache(
  queryClient: QueryClient,
  event: HeldEventResponse,
): Promise<void> {
  queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.directory(), (current) =>
    upsertHeldEventList(current, event),
  );
  await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
}

/** Removes from the shared directory; paginated list membership remains server-owned and is invalidated. */
export async function syncHeldEventDeletedCache(
  queryClient: QueryClient,
  heldEventId: string,
): Promise<void> {
  queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.directory(), (current) =>
    removeHeldEventFromList(current, heldEventId),
  );
  await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
}
