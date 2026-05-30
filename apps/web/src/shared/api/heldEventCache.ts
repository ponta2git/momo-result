import type { QueryClient } from "@tanstack/react-query";

import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";

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

export async function syncHeldEventCreatedCache(
  queryClient: QueryClient,
  scope: string,
  event: HeldEventResponse,
): Promise<void> {
  queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.scope(scope), (current) =>
    upsertHeldEventList(current, event),
  );
  await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
}

export async function syncHeldEventDeletedCache(
  queryClient: QueryClient,
  scope: string,
  heldEventId: string,
): Promise<void> {
  queryClient.setQueryData<HeldEventListResponse>(heldEventKeys.scope(scope), (current) =>
    removeHeldEventFromList(current, heldEventId),
  );
  await queryClient.invalidateQueries({ queryKey: heldEventKeys.all() });
}
