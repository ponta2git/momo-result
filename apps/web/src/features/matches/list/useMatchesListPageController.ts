import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { fetchMatchList, fetchMatchListSummary } from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListAction, MatchListSearch } from "@/features/matches/list/matchListTypes";
import { toMatchListItemViews } from "@/features/matches/list/matchListViewModel";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { getMatchDraftDetail } from "@/shared/api/matchDrafts";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowStaleShield,
} from "@/shared/api/queryErrorState";
import { heldEventKeys, masterKeys, matchKeys } from "@/shared/api/queryKeys";
import { showToast } from "@/shared/ui/feedback/Toast";

export function useMatchesListPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rawSearchSignature = searchParams.toString();
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
        setSearchParams(buildMatchListSearchParams(nextSearch));
      });
    },
    [setSearchParams, startFilterTransition],
  );
  const clearSearch = useCallback(() => {
    setOptimisticSearch(defaultMatchListSearch);
    startFilterTransition(() => {
      setSearchParams(new URLSearchParams());
    });
  }, [setSearchParams, startFilterTransition]);

  const heldEventsQuery = useQuery({
    queryFn: ({ signal }) => listHeldEvents("", 100, { signal }),
    queryKey: heldEventKeys.scope("matches-list"),
  });
  const gameTitlesQuery = useQuery({
    queryFn: ({ signal }) => listGameTitles({ signal }),
    queryKey: masterKeys.gameTitles.list("matches-list"),
  });
  const seasonsQuery = useQuery({
    queryFn: ({ signal }) => listSeasonMasters(undefined, { signal }),
    queryKey: masterKeys.seasonMasters.list("matches-list"),
  });
  const mapsQuery = useQuery({
    queryFn: ({ signal }) => listMapMasters(undefined, { signal }),
    queryKey: masterKeys.mapMasters.list("matches-list"),
  });
  const matchesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchMatchList(deferredSearch, signal),
    queryKey: matchKeys.list(deferredSearch),
  });
  const matchesSummaryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchMatchListSummary(deferredSearch, signal),
    queryKey: matchKeys.summary({
      gameTitleId: deferredSearch.gameTitleId,
      heldEventId: deferredSearch.heldEventId,
      seasonMasterId: deferredSearch.seasonMasterId,
    }),
  });

  const lookupMaps = useMemo(() => {
    return {
      gameTitlesById: new Map((gameTitlesQuery.data?.items ?? []).map((item) => [item.id, item])),
      heldEventsById: new Map((heldEventsQuery.data?.items ?? []).map((item) => [item.id, item])),
      mapsById: new Map((mapsQuery.data?.items ?? []).map((item) => [item.id, item])),
      seasonsById: new Map((seasonsQuery.data?.items ?? []).map((item) => [item.id, item])),
    };
  }, [gameTitlesQuery.data, heldEventsQuery.data, mapsQuery.data, seasonsQuery.data]);

  const items = useMemo(() => {
    return toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps);
  }, [lookupMaps, matchesQuery.data]);

  const summaryCounts = matchesSummaryQuery.data ?? {
    incompleteCount: 0,
    needsReviewCount: 0,
    ocrRunningCount: 0,
    preConfirmCount: 0,
  };

  const matchesDataUpdatedAt = matchesQuery.dataUpdatedAt;
  const summaryDataUpdatedAt = matchesSummaryQuery.dataUpdatedAt;
  const summaryIsFetching = matchesSummaryQuery.isFetching;
  const refetchSummary = matchesSummaryQuery.refetch;

  useEffect(() => {
    if (
      matchesDataUpdatedAt === 0 ||
      summaryIsFetching ||
      matchesDataUpdatedAt <= summaryDataUpdatedAt
    ) {
      return;
    }
    void refetchSummary();
  }, [matchesDataUpdatedAt, refetchSummary, summaryDataUpdatedAt, summaryIsFetching]);

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
  const pageCorrectionPending = Boolean(
    pagination &&
    !matchesQuery.isPlaceholderData &&
    search.page > Math.max(pagination.totalPages, 1),
  );

  useEffect(() => {
    if (!pagination || matchesQuery.isPlaceholderData) {
      return;
    }
    const lastPage = Math.max(pagination.totalPages, 1);
    if (search.page > lastPage) {
      applySearch({ ...search, page: lastPage });
    }
  }, [applySearch, matchesQuery.isPlaceholderData, pagination, search]);

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
    isSettling: filterSettling || pageCorrectionPending,
  });
  const showSummaryShield = shouldShowStaleShield({
    hasVisibleData: matchesSummaryQuery.data !== undefined,
    isPlaceholderData: summaryHasPlaceholderData,
    isRefreshing: summaryBackgroundRefreshing,
    isSettling: filterSettling,
  });
  const isStale = showListShield || showSummaryShield;

  const handleManualRefresh = async () => {
    if (isManualRefreshing) {
      return;
    }
    setIsManualRefreshing(true);
    try {
      await Promise.all([matchesQuery.refetch(), matchesSummaryQuery.refetch()]);
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
        queryKey: matchKeys.draft.detail(draftId),
        queryFn: ({ signal }) => getMatchDraftDetail(draftId, { signal }),
        staleTime: 0,
      });
      const destination = confirmedDraftDestination(detail);
      setDraftStatusChecking(draftId, false);
      if (destination) {
        void invalidateAfterMatchConfirmed(queryClient);
        showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
        navigate(destination.path);
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
    isStale,
    items,
    masterLoadFailed:
      shouldShowBlockingQueryError(heldEventsQuery) ||
      shouldShowBlockingQueryError(gameTitlesQuery) ||
      shouldShowBlockingQueryError(seasonsQuery) ||
      shouldShowBlockingQueryError(mapsQuery),
    pagination,
    refresh: handleManualRefresh,
    search: activeSearch,
    seasons: seasonsQuery.data?.items ?? [],
    selectDraftAction: handleDraftStatusCheckAction,
    showMatchesError: shouldShowBlockingQueryError(matchesQuery),
    showMatchesLoading: initialMatchesLoading,
    showStaleSkeleton: showListShield,
    summaryCounts,
    summaryLoading: matchesSummaryQuery.isLoading,
    summaryMasked: showSummaryShield,
    updatePage: (page: number) => {
      applySearch({ ...activeSearch, page });
    },
    updatePageSize: (pageSize: number) => {
      applySearch({ ...activeSearch, page: 1, pageSize });
    },
  };
}
