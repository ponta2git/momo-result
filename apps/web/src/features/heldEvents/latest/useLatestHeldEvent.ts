import { useQuery } from "@tanstack/react-query";

import { latestHeldEventQueryOptions } from "@/shared/api/queryOptions";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";

type LatestHeldEventView =
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly retry: () => void; readonly retrying: boolean }
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly href: string };

/** Resolves the newest held event from this visit's own read of the held-event history. */
export function useLatestHeldEvent(): LatestHeldEventView {
  const latest = useQuery(latestHeldEventQueryOptions());
  if (!latest.isFetchedAfterMount && latest.isFetching) return { kind: "loading" };
  if (!latest.isFetchedAfterMount || latest.isError || !latest.data) {
    return { kind: "failed", retry: () => void latest.refetch(), retrying: latest.isFetching };
  }
  const latestId = latest.data.latestHeldEventId;
  if (!latestId) return { kind: "none" };
  return { kind: "found", href: heldEventDetailHref(latestId, latest.data.publicId) };
}
