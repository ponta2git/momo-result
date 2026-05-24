import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "react-router-dom";

import { fetchMatchList, fetchMatchListSummary } from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  hasMatchListFilters,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import {
  sortMatchListItems,
  summarizeMatchList,
  toMatchListItemViews,
} from "@/features/matches/list/matchListViewModel";
import { listHeldEvents } from "@/shared/api/heldEvents";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { heldEventKeys, masterKeys, matchKeys } from "@/shared/api/queryKeys";

export function useMatchesListPageController() {
  const [searchParams, setSearchParams] = useSearchParams();
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
    queryFn: () => listHeldEvents("", 100),
    queryKey: heldEventKeys.scope("matches-list"),
  });
  const gameTitlesQuery = useQuery({
    queryFn: () => listGameTitles(),
    queryKey: masterKeys.gameTitles.list("matches-list"),
  });
  const seasonsQuery = useQuery({
    queryFn: () => listSeasonMasters(),
    queryKey: masterKeys.seasonMasters.list("matches-list"),
  });
  const mapsQuery = useQuery({
    queryFn: () => listMapMasters(),
    queryKey: masterKeys.mapMasters.list("matches-list"),
  });
  const matchesQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchMatchList(deferredSearch),
    queryKey: matchKeys.list(deferredSearch),
  });
  const matchesSummaryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchMatchListSummary(deferredSearch),
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

  return {
    applySearch,
    clearSearch,
    gameTitles: gameTitlesQuery.data?.items ?? [],
    hasFilters: hasMatchListFilters(activeSearch),
    heldEvents: heldEventsQuery.data?.items ?? [],
    isManualRefreshing,
    isStale:
      isFilterPending ||
      activeSearchSignature !== deferredSearchSignature ||
      (matchesQuery.isFetching && !isInitialQueryLoading(matchesQuery)),
    items,
    masterLoadFailed:
      shouldShowBlockingQueryError(heldEventsQuery) ||
      shouldShowBlockingQueryError(gameTitlesQuery) ||
      shouldShowBlockingQueryError(seasonsQuery) ||
      shouldShowBlockingQueryError(mapsQuery),
    refresh: handleManualRefresh,
    search: activeSearch,
    seasons: seasonsQuery.data?.items ?? [],
    showMatchesError: shouldShowBlockingQueryError(matchesQuery),
    showMatchesLoading: isInitialQueryLoading(matchesQuery),
    summaryCounts,
    summaryLoading: matchesSummaryQuery.isLoading,
  };
}
