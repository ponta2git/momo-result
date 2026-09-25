import type { QueryClient } from "@tanstack/react-query";

import type { HeldEventResponse, HeldEventSummaryResponse } from "@/shared/api/heldEvents";
import { heldEventKeys } from "@/shared/api/queryKeys";

export function mergeHeldEventItems(
  heldEvents: HeldEventResponse[],
  preferred: HeldEventResponse | undefined,
): HeldEventResponse[] {
  return preferred && !heldEvents.some((event) => event.id === preferred.id)
    ? [preferred, ...heldEvents]
    : heldEvents;
}

/** Seed the committed event without inventing membership or counts for a server-owned page. */
export async function syncHeldEventCreatedCache(
  queryClient: QueryClient,
  event: HeldEventResponse,
): Promise<void> {
  const queryKey = heldEventKeys.summary(event.id);
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<HeldEventSummaryResponse>(queryKey, event);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: heldEventKeys.listRoot() }),
    queryClient.invalidateQueries({
      queryKey: heldEventKeys.detailRoot(),
      predicate: ({ queryKey: key }) => key.at(-1) === "read-result",
    }),
  ]);
}

/** Remove every individual view of the deleted event; refetch affected list pages. */
export async function syncHeldEventDeletedCache(
  queryClient: QueryClient,
  heldEventId: string,
): Promise<void> {
  const queryKey = heldEventKeys.resource(heldEventId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.removeQueries({ queryKey });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: heldEventKeys.listRoot() }),
    queryClient.invalidateQueries({
      queryKey: heldEventKeys.detailRoot(),
      predicate: ({ queryKey: key }) => key[2] !== heldEventId && key.at(-1) === "read-result",
    }),
  ]);
}
