import { useQuery } from "@tanstack/react-query";

import { heldEventsQueryOptions } from "@/shared/api/queryOptions";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";

export type LatestHeldEventView =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly retry: () => void; readonly retrying: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly href: string };

/** Resolves the newest held event from this visit's own read of the held-event history. */
export function useLatestHeldEvent(): LatestHeldEventView {
  const latest = useQuery({
    ...heldEventsQueryOptions({ page: 1, pageSize: 1, sort: "held_desc" }),
    // A cached list can predate a held event created since, so this visit reads its own answer.
    staleTime: 0,
  });

  if (!latest.isFetchedAfterMount && latest.isFetching) return { kind: "loading" };
  if (!latest.data) {
    return { kind: "failed", retry: () => void latest.refetch(), retrying: latest.isFetching };
  }
  const latestId = latest.data.latestHeldEventId;
  if (!latestId) return { kind: "none" };
  const item = latest.data.items?.find((event) => event.id === latestId);
  return { kind: "found", href: heldEventDetailHref(latestId, item?.publicId) };
}
