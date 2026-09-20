import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { addMatchListReturnTo } from "@/features/matches/list/matchListNavigation";
import {
  buildMatchListApiQuery,
  buildMatchListSummaryQuery,
} from "@/features/matches/list/matchListQuery";
import { buildMatchListSearchParams } from "@/features/matches/list/matchListSearchParams";
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
  seasonMastersQueryOptions,
  matchListQueryOptions,
  matchListSummaryQueryOptions,
} from "@/shared/api/queryOptions";
import { useHeldEventPickerDirectory } from "@/shared/heldEvents/useHeldEventPickerDirectory";
import type { PaginationState } from "@/shared/lib/pagination";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";

const matchListStaleTimeMs = 10_000;

export type MatchListResource = {
  filters: {
    candidates: MatchListFilterCandidates;
    loadFailed: boolean;
    refresh: { pending: boolean; run: () => void };
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
    /** Resolves after every request settles; failures are exposed through list.refreshFailed. */
    run: () => Promise<void>;
  };
  summary: {
    counts: MatchListSummaryCounts | undefined;
    loadFailed: boolean;
    loading: boolean;
    masked: boolean;
    retryPending: boolean;
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

type ManualRefreshFailure = {
  originScope: string;
  targetScope: string;
};

/**
 * Owns list resources and filter candidates, placeholder shielding, and coordinated manual refresh.
 * Callers receive display-ready data and refresh intent rather than TanStack Query results.
 */
export function useMatchListResource({
  currentSearch,
  deferredSearch,
  listReturnTo,
  locationSettling,
  resetCursorIfUnchanged,
}: {
  currentSearch: MatchListSearch;
  deferredSearch: MatchListSearch;
  listReturnTo: string;
  locationSettling: boolean;
  resetCursorIfUnchanged: (expectedSearch: MatchListSearch) => boolean;
}): MatchListResource {
  const queryClient = useQueryClient();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [manualRefreshFailure, setManualRefreshFailure] = useState<ManualRefreshFailure | null>(
    null,
  );
  const manualRefreshingRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);

  const heldEventPicker = useHeldEventPickerDirectory({ selectedId: currentSearch.heldEventId });
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions());
  const seasonsQuery = useQuery(seasonMastersQueryOptions(currentSearch.gameTitleId || undefined));
  const matchesQuery = useQuery({
    ...matchListQueryOptions(buildMatchListApiQuery(deferredSearch)),
    staleTime: matchListStaleTimeMs,
  });
  const summaryQuery = useQuery(
    matchListSummaryQueryOptions(buildMatchListSummaryQuery(deferredSearch)),
  );
  const currentSearchScope = buildMatchListSearchParams(currentSearch).toString();
  const manualRefreshFailed = manualRefreshFailure?.targetScope === currentSearchScope;

  if (
    manualRefreshFailure !== null &&
    manualRefreshFailure.originScope !== currentSearchScope &&
    manualRefreshFailure.targetScope !== currentSearchScope
  ) {
    setManualRefreshFailure(null);
  }

  useEffect(() => {
    const generation = lifecycleGenerationRef.current;
    return () => {
      if (lifecycleGenerationRef.current === generation) {
        lifecycleGenerationRef.current += 1;
      }
    };
  }, []);

  const items = useMemo(
    () =>
      toMatchListItemViews(matchesQuery.data?.items ?? []).map((item) =>
        addMatchListReturnTo(item, listReturnTo),
      ),
    [listReturnTo, matchesQuery.data],
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
  const listFailed = useRetryNotice(
    shouldShowBlockingQueryError(matchesQuery),
    matchesQuery.isFetching || manualRefreshing,
    currentSearchScope,
  );
  const summaryFailed = useRetryNotice(
    shouldShowBlockingQueryError(summaryQuery),
    summaryQuery.isFetching,
    JSON.stringify(buildMatchListSummaryQuery(currentSearch)),
  );
  const filtersFailed = useRetryNotice(
    shouldShowBlockingQueryError(gameTitlesQuery) ||
      shouldShowBlockingQueryError(seasonsQuery) ||
      Boolean(heldEventPicker.error),
    gameTitlesQuery.isFetching || seasonsQuery.isFetching || heldEventPicker.pending,
  );
  const refreshFailed = useRetryNotice(
    manualRefreshFailed || matchesQuery.isRefetchError || summaryQuery.isRefetchError,
    manualRefreshing || sameScopeRefreshing,
    currentSearchScope,
  );

  const refresh = async () => {
    if (manualRefreshingRef.current) return;
    manualRefreshingRef.current = true;
    setManualRefreshing(true);
    const refreshGeneration = lifecycleGenerationRef.current;
    const refreshStartScope = currentSearchScope;
    const refreshedSearch = { ...currentSearch, cursor: "" };
    const refreshScope = buildMatchListSearchParams(refreshedSearch).toString();
    try {
      const listRefresh = currentSearch.cursor
        ? queryClient.fetchQuery({
            ...matchListQueryOptions(buildMatchListApiQuery(refreshedSearch)),
            staleTime: 0,
          })
        : matchesQuery.refetch({ throwOnError: true });
      const refreshResults = await Promise.allSettled([
        listRefresh,
        summaryQuery.refetch({ throwOnError: true }),
      ]);
      if (lifecycleGenerationRef.current !== refreshGeneration) return;
      const listRefreshSucceeded = refreshResults[0]?.status === "fulfilled";
      const cursorReset = Boolean(
        currentSearch.cursor && listRefreshSucceeded && resetCursorIfUnchanged(currentSearch),
      );
      if (refreshResults.some((result) => result.status === "rejected")) {
        setManualRefreshFailure({
          originScope: refreshStartScope,
          targetScope: cursorReset ? refreshScope : refreshStartScope,
        });
      } else {
        setManualRefreshFailure(null);
      }
    } catch {
      if (lifecycleGenerationRef.current === refreshGeneration) {
        setManualRefreshFailure({
          originScope: refreshStartScope,
          targetScope: refreshStartScope,
        });
      }
    } finally {
      manualRefreshingRef.current = false;
      if (lifecycleGenerationRef.current === refreshGeneration) setManualRefreshing(false);
    }
  };

  return {
    filters: {
      candidates: {
        gameTitles: gameTitlesQuery.data?.items ?? [],
        heldEvents: heldEventPicker.selectedHeldEvent
          ? [
              heldEventPicker.selectedHeldEvent,
              ...heldEventPicker.heldEvents.filter(
                (event) => event.id !== heldEventPicker.selectedHeldEvent?.id,
              ),
            ]
          : heldEventPicker.heldEvents,
        heldEventPicker: {
          error: heldEventPicker.error,
          heldEvents: heldEventPicker.heldEvents,
          pagination: heldEventPicker.pagination,
          pending: heldEventPicker.pending,
          scopeChanging: heldEventPicker.scopeChanging,
          selectedHeldEvent: heldEventPicker.selectedHeldEvent,
          onPageChange: heldEventPicker.onPageChange,
        },
        seasons: seasonsQuery.data?.items ?? [],
      },
      loadFailed: filtersFailed,
      refresh: {
        pending: gameTitlesQuery.isFetching || seasonsQuery.isFetching || heldEventPicker.pending,
        run: () => {
          if (shouldShowBlockingQueryError(gameTitlesQuery)) void gameTitlesQuery.refetch();
          if (shouldShowBlockingQueryError(seasonsQuery)) void seasonsQuery.refetch();
          if (heldEventPicker.error) void heldEventPicker.refetch();
        },
      },
    },
    list: {
      items,
      loadFailed: listFailed,
      loading: initialLoading && !listFailed,
      pagination: matchesQuery.data?.pagination,
      refreshFailed: refreshFailed && !listFailed,
      sameScopeRefreshing,
      scopeChanging: listScopeChanging,
      updating,
    },
    refresh: { pending: manualRefreshing, run: refresh },
    summary: {
      counts: summaryQuery.data,
      loadFailed: summaryFailed,
      loading: isInitialQueryLoading(summaryQuery) && !summaryFailed,
      masked: summaryMasked,
      retryPending: summaryQuery.isFetching && !manualRefreshing,
      retry: () => void summaryQuery.refetch(),
    },
  };
}
