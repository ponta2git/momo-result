import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  matchListHeldEventChoices,
  resolveMatchListDisplayState,
  toMatchListItemViews,
} from "@/features/matches/list/matchListPresentation";
import { buildMatchListApiQuery } from "@/features/matches/list/matchListQuery";
import type { MatchListRefreshResult } from "@/features/matches/list/matchListRefresh";
import { buildMatchListSearchParams } from "@/features/matches/list/matchListSearchParams";
import type {
  MatchListFilterCandidates,
  MatchListItemView,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  mapMastersQueryOptions,
  matchListQueryOptions,
  matchListSummaryQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useHeldEventPickerDirectory } from "@/shared/heldEvents/useHeldEventPickerDirectory";
import type { PaginationState } from "@/shared/lib/pagination";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

const matchListStaleTimeMs = 10_000;

export type MatchListResource = {
  /** Unconfirmed drafts across all scopes; undefined while unknown so the notice stays hidden. */
  draftCount: number | undefined;
  filters: {
    candidates: MatchListFilterCandidates;
    loadFailed: boolean;
    refresh: { pending: boolean; run: () => void };
  };
  list: {
    items: MatchListItemView[];
    memoQuery: string;
    loadFailed: boolean;
    loading: boolean;
    pagination: PaginationState | undefined;
    refreshFailed: boolean;
    sameScopeRefreshing: boolean;
    scopeChanging: boolean;
    updating: boolean;
  };
  /** Reads the first page and the draft count without changing the selected URL. */
  refresh: () => Promise<MatchListRefreshResult>;
};

/**
 * Owns list resources and filter candidates, placeholder shielding, and coordinated resource reads.
 * Callers receive display-ready data and refresh intent rather than TanStack Query results.
 */
export function useMatchListResource({
  currentSearch,
  deferredSearch,
  locationSettling,
  manualRefresh,
}: {
  currentSearch: MatchListSearch;
  deferredSearch: MatchListSearch;
  locationSettling: boolean;
  manualRefresh: { pending: boolean; failed: boolean };
}): MatchListResource {
  const queryClient = useQueryClient();

  const heldEventPicker = useHeldEventPickerDirectory({ selectedId: currentSearch.heldEventId });
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions());
  // All seasons and maps are read once so a draft title in the search sheet can scope them locally.
  const seasonsQuery = useQuery(seasonMastersQueryOptions(undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions(undefined));
  const matchesQuery = useQuery({
    ...matchListQueryOptions(buildMatchListApiQuery(deferredSearch)),
    staleTime: matchListStaleTimeMs,
  });
  const draftSummaryQuery = useQuery(matchListSummaryQueryOptions({}));
  const currentSearchScope = buildMatchListSearchParams(currentSearch).toString();

  const items = useMemo(
    () => toMatchListItemViews(matchesQuery.data?.items ?? []),
    [matchesQuery.data],
  );

  const listLoading = isInitialQueryLoading(matchesQuery);
  const displayState = resolveMatchListDisplayState({
    locationSettling,
    list: {
      available: matchesQuery.data !== undefined,
      loading: listLoading,
      refreshing: matchesQuery.isFetching && !listLoading,
      fromPreviousSelection: matchesQuery.isPlaceholderData,
    },
  });
  const listFailed = useRetryNotice(
    shouldShowBlockingQueryError(matchesQuery),
    matchesQuery.isFetching || manualRefresh.pending,
    currentSearchScope,
  );
  const candidateQueries = [gameTitlesQuery, seasonsQuery, mapsQuery];
  const filtersFailed = useRetryNotice(
    candidateQueries.some((query) => shouldShowBlockingQueryError(query)) ||
      Boolean(heldEventPicker.error),
    candidateQueries.some((query) => query.isFetching) || heldEventPicker.pending,
  );
  const refreshFailed = useRetryNotice(
    manualRefresh.failed || matchesQuery.isRefetchError,
    manualRefresh.pending || displayState.sameScopeRefreshing,
    currentSearchScope,
  );

  const refresh = async (): Promise<MatchListRefreshResult> => {
    const refreshedSearch = { ...currentSearch, cursor: "" };
    const listRefresh = currentSearch.cursor
      ? queryClient.fetchQuery({
          ...matchListQueryOptions(buildMatchListApiQuery(refreshedSearch)),
          staleTime: 0,
        })
      : matchesQuery.refetch({ throwOnError: true });
    // The draft count is a secondary notice; its failure keeps the last known count.
    const [list] = await Promise.allSettled([listRefresh, draftSummaryQuery.refetch()]);
    return list.status === "fulfilled"
      ? { kind: "refreshed", origin: currentSearch }
      : { kind: "failed", origin: currentSearch };
  };

  return {
    draftCount: draftSummaryQuery.data?.incompleteCount,
    filters: {
      candidates: {
        gameTitles: gameTitlesQuery.data?.items ?? [],
        heldEvents: matchListHeldEventChoices(
          heldEventPicker.heldEvents,
          heldEventPicker.selectedHeldEvent,
        ),
        heldEventPicker: {
          error: heldEventPicker.error,
          heldEvents: heldEventPicker.heldEvents,
          pagination: heldEventPicker.pagination,
          pending: heldEventPicker.pending,
          scopeChanging: heldEventPicker.scopeChanging,
          selectedHeldEvent: heldEventPicker.selectedHeldEvent,
          onPageChange: heldEventPicker.onPageChange,
        },
        maps: mapsQuery.data?.items ?? [],
        seasons: seasonsQuery.data?.items ?? [],
      },
      loadFailed: filtersFailed,
      refresh: {
        pending: candidateQueries.some((query) => query.isFetching) || heldEventPicker.pending,
        run: () => {
          for (const query of candidateQueries) {
            if (shouldShowBlockingQueryError(query)) void query.refetch();
          }
          if (heldEventPicker.error) void heldEventPicker.refresh();
        },
      },
    },
    list: {
      items,
      // Retained rows belong to a different search; highlight only the current response's term.
      memoQuery: matchesQuery.isPlaceholderData ? "" : deferredSearch.q,
      loadFailed: listFailed,
      loading: displayState.initialLoading && !listFailed,
      pagination: matchesQuery.data?.pagination,
      refreshFailed: refreshFailed && !listFailed,
      sameScopeRefreshing: displayState.sameScopeRefreshing,
      scopeChanging: displayState.scopeChanging,
      updating: displayState.updating,
    },
    refresh,
  };
}
