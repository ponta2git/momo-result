import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  confirmedDraftDestination,
  confirmedDraftMessages,
} from "@/features/matches/confirmedDraftNavigation";
import { addMatchListReturnTo } from "@/features/matches/list/matchListNavigation";
import {
  buildMatchListApiQuery,
  buildMatchListSummaryQuery,
} from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListAction, MatchListSearch } from "@/features/matches/list/matchListTypes";
import { toMatchListItemViews } from "@/features/matches/list/matchListViewModel";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  matchDraftDetailQueryOptions,
  matchListQueryOptions,
  matchListSummaryQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import { sanitizeReturnTo, withReturnTo } from "@/shared/navigation/returnTo";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useMatchesListPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rawSearchSignature = searchParams.toString();
  const parentReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const listReturnTo = `/matches${rawSearchSignature ? `?${rawSearchSignature}` : ""}`;
  const search = useMemo(
    () => parseMatchListSearchParams(new URLSearchParams(rawSearchSignature)),
    [rawSearchSignature],
  );
  const [optimisticSearch, setOptimisticSearch] = useState<MatchListSearch | null>(null);
  const activeSearch = optimisticSearch ?? search;
  const deferredSearch = useDeferredValue(activeSearch);
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const checkingDraftIdsRef = useRef(new Set<string>());
  const [checkingDraftIds, setCheckingDraftIds] = useState<ReadonlySet<string>>(() => new Set());

  const applySearch = useCallback(
    (nextSearch: MatchListSearch) => {
      setOptimisticSearch(nextSearch);
      startFilterTransition(() => {
        const nextParams = buildMatchListSearchParams(nextSearch);
        if (parentReturnTo) nextParams.set("returnTo", parentReturnTo);
        setSearchParams(nextParams);
      });
    },
    [parentReturnTo, setSearchParams, startFilterTransition],
  );
  const clearSearch = useCallback(() => {
    setOptimisticSearch(defaultMatchListSearch);
    startFilterTransition(() => {
      const nextParams = new URLSearchParams();
      if (parentReturnTo) nextParams.set("returnTo", parentReturnTo);
      setSearchParams(nextParams);
    });
  }, [parentReturnTo, setSearchParams, startFilterTransition]);

  const heldEventsQuery = useQuery(heldEventDirectoryQueryOptions());
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions("matches-list"));
  const seasonsQuery = useQuery(seasonMastersQueryOptions("matches-list", undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions("matches-list", undefined));
  const matchesQuery = useQuery(matchListQueryOptions(buildMatchListApiQuery(deferredSearch)));
  const matchesSummaryQuery = useQuery(
    matchListSummaryQueryOptions(buildMatchListSummaryQuery(deferredSearch)),
  );

  const lookupMaps = useMemo(() => {
    return {
      gameTitlesById: new Map((gameTitlesQuery.data?.items ?? []).map((item) => [item.id, item])),
      heldEventsById: new Map((heldEventsQuery.data?.items ?? []).map((item) => [item.id, item])),
      mapsById: new Map((mapsQuery.data?.items ?? []).map((item) => [item.id, item])),
      seasonsById: new Map((seasonsQuery.data?.items ?? []).map((item) => [item.id, item])),
    };
  }, [gameTitlesQuery.data, heldEventsQuery.data, mapsQuery.data, seasonsQuery.data]);

  const items = useMemo(() => {
    return toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps).map((item) =>
      addMatchListReturnTo(item, listReturnTo),
    );
  }, [listReturnTo, lookupMaps, matchesQuery.data]);

  const summaryCounts = matchesSummaryQuery.data ?? {
    incompleteCount: 0,
    needsReviewCount: 0,
    ocrRunningCount: 0,
    preConfirmCount: 0,
  };

  const searchSignature = useMemo(() => buildMatchListSearchParams(search).toString(), [search]);
  const activeSearchSignature = useMemo(
    () => buildMatchListSearchParams(activeSearch).toString(),
    [activeSearch],
  );
  const deferredSearchSignature = useMemo(
    () => buildMatchListSearchParams(deferredSearch).toString(),
    [deferredSearch],
  );

  useEffect(() => {
    if (
      optimisticSearch &&
      searchSignature === buildMatchListSearchParams(optimisticSearch).toString()
    ) {
      setOptimisticSearch(null);
    }
  }, [optimisticSearch, searchSignature]);

  const pagination = matchesQuery.data?.pagination;

  const initialMatchesLoading = isInitialQueryLoading(matchesQuery);
  const filterSettling = isFilterPending || activeSearchSignature !== deferredSearchSignature;
  const listHasPlaceholderData = matchesQuery.isPlaceholderData;
  const summaryHasPlaceholderData = matchesSummaryQuery.isPlaceholderData;
  const listBackgroundRefreshing = matchesQuery.isFetching && !initialMatchesLoading;
  const summaryBackgroundRefreshing =
    matchesSummaryQuery.isFetching && matchesSummaryQuery.data !== undefined;
  const showListShield = shouldShowStaleShield({
    hasVisibleData: matchesQuery.data !== undefined,
    isPlaceholderData: listHasPlaceholderData,
    isRefreshing: listBackgroundRefreshing,
    isSettling: filterSettling,
  });
  const showSummaryShield = shouldShowStaleShield({
    hasVisibleData: matchesSummaryQuery.data !== undefined,
    isPlaceholderData: summaryHasPlaceholderData,
    isRefreshing: summaryBackgroundRefreshing,
    isSettling: filterSettling,
  });
  const listScopeChanging = filterSettling || listHasPlaceholderData;
  const sameScopeRefreshing =
    !listScopeChanging && (listBackgroundRefreshing || summaryBackgroundRefreshing);
  const matchesRefreshFailed = matchesQuery.isRefetchError || matchesSummaryQuery.isRefetchError;

  const handleManualRefresh = async () => {
    if (isManualRefreshing) {
      return;
    }
    setIsManualRefreshing(true);
    try {
      const refreshedSearch = { ...activeSearch, cursor: "" };
      if (activeSearch.cursor) applySearch(refreshedSearch);
      const listRefresh = activeSearch.cursor
        ? queryClient.fetchQuery({
            ...matchListQueryOptions(buildMatchListApiQuery(refreshedSearch)),
            staleTime: 0,
          })
        : matchesQuery.refetch();
      await Promise.all([
        listRefresh,
        matchesSummaryQuery.refetch(),
        heldEventsQuery.refetch(),
        gameTitlesQuery.refetch(),
        seasonsQuery.refetch(),
        mapsQuery.refetch(),
      ]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const setDraftStatusChecking = useCallback((draftId: string, checking: boolean) => {
    const nextDraftIds = new Set(checkingDraftIdsRef.current);
    if (checking) {
      nextDraftIds.add(draftId);
    } else {
      nextDraftIds.delete(draftId);
    }
    checkingDraftIdsRef.current = nextDraftIds;
    setCheckingDraftIds(nextDraftIds);
  }, []);

  const handleDraftStatusCheckAction = async (action: MatchListAction) => {
    const draftId = action.draftStatusCheck?.draftId;
    if (!draftId || !action.href || checkingDraftIdsRef.current.has(draftId)) {
      return;
    }

    setDraftStatusChecking(draftId, true);
    try {
      const detail = await queryClient.fetchQuery({
        ...matchDraftDetailQueryOptions(draftId),
        staleTime: 0,
      });
      const destination = confirmedDraftDestination(detail);
      setDraftStatusChecking(draftId, false);
      if (destination) {
        void invalidateAfterMatchConfirmed(queryClient);
        showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
        navigate(withReturnTo(destination.path, listReturnTo));
        return;
      }

      navigate(action.href);
    } catch {
      setDraftStatusChecking(draftId, false);
      showToast({ title: confirmedDraftMessages.statusCheckFailed, tone: "warning" });
    }
  };

  return {
    applySearch,
    checkingDraftIds,
    clearSearch,
    gameTitles: gameTitlesQuery.data?.items ?? [],
    hasFilters: hasMatchListFilters(activeSearch),
    heldEvents: heldEventsQuery.data?.items ?? [],
    isManualRefreshing,
    items,
    listScopeChanging,
    listUpdating: showListShield,
    masterLoadFailed:
      shouldShowBlockingQueryError(heldEventsQuery) ||
      shouldShowBlockingQueryError(gameTitlesQuery) ||
      shouldShowBlockingQueryError(seasonsQuery) ||
      shouldShowBlockingQueryError(mapsQuery),
    pagination,
    navigation: {
      backHref: parentReturnTo,
      exportHref: withReturnTo("/exports", listReturnTo),
      manualCreateHref: withReturnTo("/matches/new", listReturnTo),
      ocrHref: withReturnTo("/ocr/new", listReturnTo),
    },
    refresh: handleManualRefresh,
    matchesRefreshFailed,
    sameScopeRefreshing,
    search: activeSearch,
    seasons: seasonsQuery.data?.items ?? [],
    selectDraftAction: handleDraftStatusCheckAction,
    showMatchesError: shouldShowBlockingQueryError(matchesQuery),
    showMatchesLoading: initialMatchesLoading,
    summaryCounts,
    summaryLoading: matchesSummaryQuery.isLoading,
    summaryMasked: showSummaryShield,
    updatePage: (page: number) => {
      if (!pagination) return;
      const cursor = cursorForPage(pagination, page);
      if (cursor !== undefined) applySearch({ ...activeSearch, cursor });
    },
    updatePageSize: (pageSize: number) => {
      applySearch({ ...activeSearch, cursor: "", pageSize });
    },
  };
}
