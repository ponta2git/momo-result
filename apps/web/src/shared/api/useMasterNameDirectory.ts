import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { shouldShowBlockingQueryError, shouldShowQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";

const noGameTitles: GameTitleResponse[] = [];
const noMaps: MapMasterResponse[] = [];
const noSeasons: SeasonMasterResponse[] = [];

function nameMap(items: ReadonlyArray<{ id: string; name: string }>) {
  return new Map(items.map((item) => [item.id, item.name]));
}

/** Shares master-name data, failure policy, and retry behavior across read-only pages. */
export function useMasterNameDirectory() {
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions());
  const mapsQuery = useQuery(mapMastersQueryOptions(undefined));
  const seasonsQuery = useQuery(seasonMastersQueryOptions(undefined));
  const refetchGameTitles = gameTitlesQuery.refetch;
  const refetchMaps = mapsQuery.refetch;
  const refetchSeasons = seasonsQuery.refetch;
  const gameTitles = gameTitlesQuery.data?.items ?? noGameTitles;
  const maps = mapsQuery.data?.items ?? noMaps;
  const seasons = seasonsQuery.data?.items ?? noSeasons;
  const failed = {
    gameTitles: shouldShowQueryError(gameTitlesQuery),
    maps: shouldShowQueryError(mapsQuery),
    seasons: shouldShowQueryError(seasonsQuery),
  };
  const names = useMemo(
    () => ({
      gameTitles: nameMap(gameTitles),
      maps: nameMap(maps),
      seasons: nameMap(seasons),
    }),
    [gameTitles, maps, seasons],
  );
  const refresh = useCallback(async () => {
    await Promise.all([refetchGameTitles(), refetchMaps(), refetchSeasons()]);
  }, [refetchGameTitles, refetchMaps, refetchSeasons]);
  const retryFailed = useCallback(async () => {
    const retries: Array<Promise<unknown>> = [];
    if (failed.gameTitles) retries.push(refetchGameTitles());
    if (failed.maps) retries.push(refetchMaps());
    if (failed.seasons) retries.push(refetchSeasons());
    await Promise.all(retries);
  }, [
    failed.gameTitles,
    failed.maps,
    failed.seasons,
    refetchGameTitles,
    refetchMaps,
    refetchSeasons,
  ]);

  return {
    blockingLoadFailed:
      shouldShowBlockingQueryError(gameTitlesQuery) ||
      shouldShowBlockingQueryError(mapsQuery) ||
      shouldShowBlockingQueryError(seasonsQuery),
    failed,
    initialPending:
      (gameTitlesQuery.data === undefined && gameTitlesQuery.isFetching) ||
      (mapsQuery.data === undefined && mapsQuery.isFetching) ||
      (seasonsQuery.data === undefined && seasonsQuery.isFetching),
    items: { gameTitles, maps, seasons },
    names,
    pending: {
      gameTitles: gameTitlesQuery.data === undefined && gameTitlesQuery.isFetching,
      maps: mapsQuery.data === undefined && mapsQuery.isFetching,
      seasons: seasonsQuery.data === undefined && seasonsQuery.isFetching,
    },
    refresh,
    refreshing: gameTitlesQuery.isFetching || mapsQuery.isFetching || seasonsQuery.isFetching,
    retryFailed,
  };
}
