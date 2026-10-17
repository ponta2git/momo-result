import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  buildHeldEventsListSnapshot,
  heldEventsPageCorrection,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import type { HeldEventsPagination } from "@/features/heldEvents/list/heldEventsListPresentation";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { heldEventsQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Only a confirmed page can correct the requested page; retained rows never acquire its scope. */
export function useHeldEventsListResource(requested: HeldEventsPagination, scope: string) {
  const query = useQuery(heldEventsQueryOptions(requested));
  const { data, isFetching, isPlaceholderData, refetch } = query;
  const hasCurrentScopeData = data !== undefined && !isPlaceholderData;
  const loadFailed = useRetryNotice(
    shouldShowBlockingQueryError(query) || (shouldShowQueryError(query) && !hasCurrentScopeData),
    isFetching,
    scope,
  );
  const stale = useRetryNotice(
    shouldShowQueryError(query) && hasCurrentScopeData,
    isFetching,
    scope,
  );
  const correctionPage = heldEventsPageCorrection(requested, data?.pagination, isPlaceholderData);
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    snapshot: buildHeldEventsListSnapshot({
      requested,
      data,
      initialLoading: isInitialQueryLoading(query),
      loadFailed,
      stale,
      placeholder: isPlaceholderData,
      fetching: isFetching,
      correctionPage,
    }),
    correctionPage,
    refresh: { pending: isFetching, run: refresh },
  };
}
