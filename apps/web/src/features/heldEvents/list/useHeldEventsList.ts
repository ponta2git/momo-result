import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  buildHeldEventsListSnapshot,
  changeHeldEventsPagination,
  heldEventsPageCorrection,
  heldEventsPaginationParams,
  readHeldEventsPagination,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import type { HeldEventsPagination } from "@/features/heldEvents/list/heldEventsListPresentation";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { heldEventsQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

/** Owns list navigation and its read snapshot, including server-confirmed page correction. */
export function useHeldEventsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const requested = useMemo(() => readHeldEventsPagination(searchParams), [searchParams]);
  const query = useQuery(heldEventsQueryOptions(requested));
  const { data, isFetching, isPlaceholderData, refetch } = query;
  const hasCurrentScopeData = data !== undefined && !isPlaceholderData;
  const rawSearch = searchParams.toString();
  const loadFailed = useRetryNotice(
    shouldShowBlockingQueryError(query) || (shouldShowQueryError(query) && !hasCurrentScopeData),
    isFetching,
    rawSearch,
  );
  const stale = useRetryNotice(
    shouldShowQueryError(query) && hasCurrentScopeData,
    isFetching,
    rawSearch,
  );
  const updatePagination = useCallback(
    (next: HeldEventsPagination) => {
      void navigate({ search: heldEventsPaginationParams(next).toString(), hash: location.hash });
    },
    [location.hash, navigate],
  );
  const correctionPage = heldEventsPageCorrection(requested, data?.pagination, isPlaceholderData);
  useEffect(() => {
    if (correctionPage !== undefined) {
      updatePagination({ ...requested, page: correctionPage });
    }
  }, [correctionPage, requested, updatePagination]);
  const updatePage = useCallback(
    (page: number) =>
      updatePagination(changeHeldEventsPagination(requested, { kind: "page", page })),
    [requested, updatePagination],
  );
  const updatePageSize = useCallback(
    (pageSize: number) =>
      updatePagination(changeHeldEventsPagination(requested, { kind: "pageSize", pageSize })),
    [requested, updatePagination],
  );
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
    refresh: { pending: isFetching, run: refresh },
    updatePage,
    updatePageSize,
  } as const;
}
