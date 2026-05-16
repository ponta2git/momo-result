import type { QueryClient } from "@tanstack/react-query";

import type { HeldEventListResponse, HeldEventResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";

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
