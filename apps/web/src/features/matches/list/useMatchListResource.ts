import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { addMatchListReturnTo } from "@/features/matches/list/matchListNavigation";
import {
  buildMatchListApiQuery,
  buildMatchListSummaryQuery,
} from "@/features/matches/list/matchListQuery";
import type {
  MatchListFilterCandidates,
  MatchListItemView,
  MatchListSearch,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { toMatchListItemViews } from "@/features/matches/list/matchListViewModel";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  matchListQueryOptions,
  matchListSummaryQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useHeldEventPickerDirectory } from "@/shared/api/useHeldEventPickerDirectory";
import type { PaginationState } from "@/shared/lib/pagination";

export type MatchListResource = {
  filters: {
    candidates: MatchListFilterCandidates;
    loadFailed: boolean;
  };
  list: {
    items: MatchListItemView[];
    loadFailed: boolean;
    loading: boolean;
    pagination: PaginationState | undefined;
    refreshFailed: boolean;
    sameScopeRefreshing: boolean;
    scopeChanging: boolean;
    updating: boolean;
  };
  refresh: {
    pending: boolean;
    run: () => Promise<void>;
  };
  summary: {
    counts: MatchListSummaryCounts | undefined;
    loadFailed: boolean;
    loading: boolean;
    masked: boolean;
    retry: () => void;
  };
};

function summaryScopeChanged(current: MatchListSearch, deferred: MatchListSearch): boolean {
  return (
    current.gameTitleId !== deferred.gameTitleId ||
    current.heldEventId !== deferred.heldEventId ||
    current.seasonMasterId !== deferred.seasonMasterId
  );
}

/**
 * Owns the six list resources, lookup joins, placeholder shielding, and coordinated manual refresh.
 * Callers receive display-ready data and refresh intent rather than TanStack Query results.
 */
export function useMatchListResource({
  currentSearch,
  deferredSearch,
  listReturnTo,
  locationSettling,
  resetCursor,
}: {
  currentSearch: MatchListSearch;
  deferredSearch: MatchListSearch;
  listReturnTo: string;
  locationSettling: boolean;
  resetCursor: () => void;
}): MatchListResource {
  const queryClient = useQueryClient();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const manualRefreshingRef = useRef(false);

  const heldEventsQuery = useQuery(heldEventDirectoryQueryOptions());
  const selectedHeldEvent = (heldEventsQuery.data?.items ?? []).find(
    (event) => event.id === currentSearch.heldEventId,
  );
  const heldEventPicker = useHeldEventPickerDirectory({
    selectedEvent: selectedHeldEvent,
    selectedId: currentSearch.heldEventId,
  });
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions("matches-list"));
  const seasonsQuery = useQuery(seasonMastersQueryOptions("matches-list", undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions("matches-list", undefined));
  const matchesQuery = useQuery(matchListQueryOptions(buildMatchListApiQuery(deferredSearch)));
  const summaryQuery = useQuery(
    matchListSummaryQueryOptions(buildMatchListSummaryQuery(deferredSearch)),
  );

  const lookupMaps = useMemo(
    () => ({
      gameTitlesById: new Map((gameTitlesQuery.data?.items ?? []).map((item) => [item.id, item])),
      heldEventsById: new Map((heldEventsQuery.data?.items ?? []).map((item) => [item.id, item])),
      mapsById: new Map((mapsQuery.data?.items ?? []).map((item) => [item.id, item])),
      seasonsById: new Map((seasonsQuery.data?.items ?? []).map((item) => [item.id, item])),
    }),
    [gameTitlesQuery.data, heldEventsQuery.data, mapsQuery.data, seasonsQuery.data],
  );
  const items = useMemo(
    () =>
      toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps).map((item) =>
        addMatchListReturnTo(item, listReturnTo),
      ),
    [listReturnTo, lookupMaps, matchesQuery.data],
  );

  const initialLoading = isInitialQueryLoading(matchesQuery);
  const listScopeChanging = locationSettling || matchesQuery.isPlaceholderData;
  const summaryMasked =
    summaryScopeChanged(currentSearch, deferredSearch) || summaryQuery.isPlaceholderData;
  const listBackgroundRefreshing = matchesQuery.isFetching && !initialLoading;
  const summaryBackgroundRefreshing = summaryQuery.isFetching && summaryQuery.data !== undefined;
  const sameScopeRefreshing =
    !listScopeChanging && (listBackgroundRefreshing || summaryBackgroundRefreshing);
  const updating = shouldShowStaleShield({
    hasVisibleData: matchesQuery.data !== undefined,
    isPlaceholderData: matchesQuery.isPlaceholderData,
    isRefreshing: listBackgroundRefreshing,
    isSettling: locationSettling,
  });

  const refresh = async () => {
    if (manualRefreshingRef.current) return;
    manualRefreshingRef.current = true;
    setManualRefreshing(true);
    try {
      const refreshedSearch = { ...currentSearch, cursor: "" };
      if (currentSearch.cursor) resetCursor();
      const listRefresh = currentSearch.cursor
        ? queryClient.fetchQuery({
            ...matchListQueryOptions(buildMatchListApiQuery(refreshedSearch)),
            staleTime: 0,
          })
        : matchesQuery.refetch();
      await Promise.all([
        listRefresh,
        summaryQuery.refetch(),
        heldEventsQuery.refetch(),
        heldEventPicker.refetch(),
        gameTitlesQuery.refetch(),
        seasonsQuery.refetch(),
        mapsQuery.refetch(),
      ]);
    } finally {
      manualRefreshingRef.current = false;
      setManualRefreshing(false);
    }
  };

  return {
    filters: {
      candidates: {
        gameTitles: gameTitlesQuery.data?.items ?? [],
        heldEvents: heldEventsQuery.data?.items ?? [],
        heldEventPicker: {
          error: heldEventPicker.error,
          heldEvents: heldEventPicker.heldEvents,
          pagination: heldEventPicker.pagination,
          pending: heldEventPicker.pending,
          selectedHeldEvent: heldEventPicker.selectedHeldEvent,
          onPageChange: heldEventPicker.onPageChange,
        },
        seasons: seasonsQuery.data?.items ?? [],
      },
      loadFailed:
        shouldShowBlockingQueryError(heldEventsQuery) ||
        shouldShowBlockingQueryError(gameTitlesQuery) ||
        shouldShowBlockingQueryError(seasonsQuery) ||
        shouldShowBlockingQueryError(mapsQuery),
    },
    list: {
      items,
      loadFailed: shouldShowBlockingQueryError(matchesQuery),
      loading: initialLoading,
      pagination: matchesQuery.data?.pagination,
      refreshFailed: matchesQuery.isRefetchError || summaryQuery.isRefetchError,
      sameScopeRefreshing,
      scopeChanging: listScopeChanging,
      updating,
    },
    refresh: { pending: manualRefreshing, run: refresh },
    summary: {
      counts: summaryQuery.data,
      loadFailed: shouldShowBlockingQueryError(summaryQuery),
      loading: isInitialQueryLoading(summaryQuery),
      masked: summaryMasked,
      retry: () => void summaryQuery.refetch(),
    },
  };
}
