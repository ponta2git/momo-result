import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { buildHeldEventListApiQuery } from "@/features/heldEvents/list/heldEventListQuery";
import type {
  HeldEventListFilterCandidates,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import {
  heldEventsPageCorrection,
  resolveHeldEventListDisplayState,
  toHeldEventListRows,
} from "@/features/heldEvents/list/heldEventsListPresentation";
import type { HeldEventListRowView } from "@/features/heldEvents/list/heldEventsListPresentation";
import { heldEventListSearchSignature } from "@/features/heldEvents/list/useHeldEventListSelection";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventsQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import type { PaginationState } from "@/shared/lib/pagination";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

export type HeldEventsListResource = {
  /** A confirmed read of the requested search showed the page is beyond the last one. */
  correctionPage: number | undefined;
  filters: {
    candidates: HeldEventListFilterCandidates;
    loadFailed: boolean;
    refresh: { pending: boolean; run: () => void };
  };
  list: {
    /** The member whose average rank the shown rows were narrowed by. */
    emphasizedMemberId: string;
    loadFailed: boolean;
    loading: boolean;
    memoQuery: string;
    pagination: PaginationState | undefined;
    rows: HeldEventListRowView[];
    /** A same-scope refresh failed; the retained rows may no longer be current. */
    stale: boolean;
    sameScopeRefreshing: boolean;
    scopeChanging: boolean;
    updating: boolean;
  };
  refresh: { pending: boolean; run: () => void };
};

/**
 * Owns the list read and filter candidates, placeholder shielding, and page correction. Callers
 * receive display-ready rows and refresh intent rather than TanStack Query results.
 */
export function useHeldEventsListResource({
  currentSearch,
  deferredSearch,
  locationSettling,
}: {
  currentSearch: HeldEventListSearch;
  deferredSearch: HeldEventListSearch;
  locationSettling: boolean;
}): HeldEventsListResource {
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions());
  // All seasons and maps are read once so a draft title in the search sheet can scope them locally.
  const seasonsQuery = useQuery(seasonMastersQueryOptions(undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions(undefined));
  const query = useQuery(heldEventsQueryOptions(buildHeldEventListApiQuery(deferredSearch)));
  const { data, isFetching, isPlaceholderData, refetch } = query;
  const currentScope = heldEventListSearchSignature(currentSearch);
  const hasCurrentScopeData = data !== undefined && !isPlaceholderData;

  const loadFailed = useRetryNotice(
    shouldShowBlockingQueryError(query) || (shouldShowQueryError(query) && !hasCurrentScopeData),
    isFetching,
    currentScope,
  );
  const stale = useRetryNotice(
    shouldShowQueryError(query) && hasCurrentScopeData,
    isFetching,
    currentScope,
  );
  const correctionPage = heldEventsPageCorrection(
    deferredSearch.page,
    data?.pagination,
    hasCurrentScopeData && heldEventListSearchSignature(deferredSearch) === currentScope,
  );
  const initialLoading = isInitialQueryLoading(query);
  const displayState = resolveHeldEventListDisplayState({
    locationSettling,
    list: {
      available: data !== undefined,
      fromPreviousSelection: isPlaceholderData,
      refreshing: isFetching && !initialLoading,
    },
  });
  const rows = useMemo(
    () => toHeldEventListRows(data?.items ?? [], data?.latestHeldEventId ?? undefined),
    [data],
  );

  const candidateQueries = [gameTitlesQuery, seasonsQuery, mapsQuery];
  const filtersFailed = useRetryNotice(
    candidateQueries.some((candidateQuery) => shouldShowBlockingQueryError(candidateQuery)),
    candidateQueries.some((candidateQuery) => candidateQuery.isFetching),
  );
  const { metric } = deferredSearch;

  return {
    correctionPage,
    filters: {
      candidates: {
        gameTitles: gameTitlesQuery.data?.items ?? [],
        maps: mapsQuery.data?.items ?? [],
        seasons: seasonsQuery.data?.items ?? [],
      },
      loadFailed: filtersFailed,
      refresh: {
        pending: candidateQueries.some((candidateQuery) => candidateQuery.isFetching),
        run: () => {
          for (const candidateQuery of candidateQueries) {
            if (shouldShowBlockingQueryError(candidateQuery)) void candidateQuery.refetch();
          }
        },
      },
    },
    list: {
      // Retained rows belong to a different search; mark only the current response's conditions.
      emphasizedMemberId:
        !isPlaceholderData && metric.metric === "average_rank" ? metric.memberId : "",
      loadFailed: loadFailed && correctionPage === undefined,
      loading: (initialLoading && !loadFailed) || correctionPage !== undefined,
      memoQuery: isPlaceholderData ? "" : deferredSearch.q,
      pagination: data?.pagination,
      rows,
      stale,
      sameScopeRefreshing: displayState.sameScopeRefreshing,
      scopeChanging: displayState.scopeChanging,
      updating: displayState.updating,
    },
    refresh: {
      pending: isFetching,
      run: () => {
        void refetch();
      },
    },
  };
}
