import { useQuery } from "@tanstack/react-query";

import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventRecordContextQueryOptions } from "@/shared/api/queryOptions";

/**
 * What a record started from a held event carries over: the event with its next match number,
 * and the conditions of its previous match. A cached context can predate a match confirmed or
 * deleted since, so a stale one is refetched and waited for before it decides any default.
 */
export function useRecordContext(heldEventId: string | undefined, enabled = true) {
  const active = enabled && Boolean(heldEventId);
  const query = useQuery(heldEventRecordContextQueryOptions(heldEventId, active));
  const context = query.data?.kind === "found" ? query.data.value : undefined;
  return {
    event: context?.event,
    previous: context?.previousMatch,
    pending: active && query.isFetching && (query.isStale || query.data === undefined),
    fetching: active && query.isFetching,
    notFound: query.data?.kind === "notFound",
    error: query.error,
    showError: active && shouldShowQueryError(query),
    retry: query.refetch,
  };
}

export type RecordContext = ReturnType<typeof useRecordContext>;
