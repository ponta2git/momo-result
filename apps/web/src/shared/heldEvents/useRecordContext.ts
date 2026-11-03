import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { readDetailQuery } from "@/shared/api/detailReadResult";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { heldEventDetailQueryOptions } from "@/shared/api/queryOptions";
import { heldEventFromDetail, previousMatchSetup } from "@/shared/heldEvents/recordContext";

/**
 * What a record started from a held event carries over: the event with its next match number,
 * and the conditions of its previous match. A cached detail can predate a match confirmed or
 * deleted since, so a stale one is refetched and waited for before it decides any default.
 */
export function useRecordContext(heldEventId: string | undefined, enabled = true) {
  const active = enabled && Boolean(heldEventId);
  const query = useQuery(heldEventDetailQueryOptions(heldEventId, active));
  const read = readDetailQuery(query);
  const detail = read.detail;
  const event = useMemo(() => (detail ? heldEventFromDetail(detail) : undefined), [detail]);
  const previous = useMemo(() => previousMatchSetup(detail), [detail]);
  return {
    event,
    previous,
    pending: active && query.isFetching && (query.isStale || query.data === undefined),
    fetching: active && query.isFetching,
    notFound: read.notFound,
    error: read.error,
    showError: active && shouldShowQueryError(query),
    retry: query.refetch,
  };
}

export type RecordContext = ReturnType<typeof useRecordContext>;
