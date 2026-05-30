import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
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
import {
  sortMatchListItems,
  summarizeMatchList,
  toMatchListItemViews,
} from "@/features/matches/list/matchListViewModel";
import { invalidateAfterMatchConfirmed } from "@/shared/api/cacheInvalidation";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { getMatchDraftDetail } from "@/shared/api/matchDrafts";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
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
  const [checkingDraftId, setCheckingDraftId] = useState<string | null>(null);

  const applySearch = (nextSearch: MatchListSearch) => {
    setOptimisticSearch(nextSearch);
    startFilterTransition(() => {
      setSearchParams(buildMatchListSearchParams(nextSearch));
    });
  };
  const clearSearch = () => {
    setOptimisticSearch(defaultMatchListSearch);
    startFilterTransition(() => {
      setSearchParams(new URLSearchParams());
    });
  };

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
    const views = toMatchListItemViews(matchesQuery.data?.items ?? [], lookupMaps);
    return sortMatchListItems(views, deferredSearch.sort);
  }, [lookupMaps, matchesQuery.data, deferredSearch.sort]);

  const summaryCountItems = useMemo(
    () => toMatchListItemViews(matchesSummaryQuery.data?.items ?? [], lookupMaps),
    [lookupMaps, matchesSummaryQuery.data],
  );

  const summaryCounts = useMemo(() => summarizeMatchList(summaryCountItems), [summaryCountItems]);

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

  const initialMatchesLoading = isInitialQueryLoading(matchesQuery);
  const filterSettling = isFilterPending || activeSearchSignature !== deferredSearchSignature;
  const listHasPlaceholderData = matchesQuery.isPlaceholderData;
  const summaryHasPlaceholderData = matchesSummaryQuery.isPlaceholderData;
  const listBackgroundRefreshing = matchesQuery.isFetching && !initialMatchesLoading;
  const isStale =
    filterSettling ||
    listHasPlaceholderData ||
    summaryHasPlaceholderData ||
    listBackgroundRefreshing;

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

  const handleDraftStatusCheckAction = async (action: MatchListAction) => {
    const draftId = action.draftStatusCheck?.draftId;
    if (!draftId || !action.href || checkingDraftId) {
      return;
    }

    setCheckingDraftId(draftId);
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: matchKeys.draft.detail(draftId),
        queryFn: ({ signal }) => getMatchDraftDetail(draftId, { signal }),
        staleTime: 0,
      });
      const destination = confirmedDraftDestination(detail);
      setCheckingDraftId(null);
      if (destination) {
        void invalidateAfterMatchConfirmed(queryClient);
        showToast({ title: confirmedDraftMessages.listRedirect, tone: "warning" });
        navigate(destination.path);
        return;
      }

      navigate(action.href);
    } catch {
      setCheckingDraftId(null);
      showToast({ title: confirmedDraftMessages.statusCheckFailed, tone: "warning" });
    }
  };

  return {
    applySearch,
    checkingDraftId,
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
    refresh: handleManualRefresh,
    search: activeSearch,
    seasons: seasonsQuery.data?.items ?? [],
    selectDraftAction: handleDraftStatusCheckAction,
    showMatchesError: shouldShowBlockingQueryError(matchesQuery),
    showMatchesLoading: initialMatchesLoading,
    showStaleSkeleton: filterSettling || listHasPlaceholderData,
    summaryCounts,
    summaryLoading: matchesSummaryQuery.isLoading,
  };
}
