import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  buildMatchListApiQuery,
  buildMatchListSummaryQuery,
} from "@/features/matches/list/matchListQuery";
import type { MatchListRefreshResult } from "@/features/matches/list/matchListRefresh";
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
  /** Reads the first page and summary without changing the selected URL. */
  refresh: () => Promise<MatchListRefreshResult>;
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
  const seasonsQuery = useQuery(seasonMastersQueryOptions(currentSearch.gameTitleId || undefined));
  const matchesQuery = useQuery({
    ...matchListQueryOptions(buildMatchListApiQuery(deferredSearch)),
    staleTime: matchListStaleTimeMs,
  });
  const summaryQuery = useQuery(
    matchListSummaryQueryOptions(buildMatchListSummaryQuery(deferredSearch)),
  );
  const currentSearchScope = buildMatchListSearchParams(currentSearch).toString();

  const items = useMemo(
    () => toMatchListItemViews(matchesQuery.data?.items ?? []),
    [matchesQuery.data],
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
    matchesQuery.isFetching || manualRefresh.pending,
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
    manualRefresh.failed || matchesQuery.isRefetchError || summaryQuery.isRefetchError,
    manualRefresh.pending || sameScopeRefreshing,
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
    const [list, summary] = await Promise.allSettled([
      listRefresh,
      summaryQuery.refetch({ throwOnError: true }),
    ]);
    return list.status === "fulfilled"
      ? { kind: "refreshed", origin: currentSearch, summaryFailed: summary.status === "rejected" }
      : { kind: "failed", origin: currentSearch };
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
    refresh,
    summary: {
      counts: summaryQuery.data,
      loadFailed: summaryFailed,
      loading: isInitialQueryLoading(summaryQuery) && !summaryFailed,
      masked: summaryMasked,
      retryPending: summaryQuery.isFetching && !manualRefresh.pending,
      retry: () => void summaryQuery.refetch(),
    },
  };
}
