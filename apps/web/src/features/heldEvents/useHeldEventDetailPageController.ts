import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { buildHeldEventPlayerRecaps } from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventMasterNames } from "@/features/heldEvents/heldEventDetailViewModel";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDetailQueryOptions,
  mapMastersQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { currentInternalLocation, sanitizeReturnTo } from "@/shared/navigation/returnTo";

function nameMap(items: ReadonlyArray<{ id: string; name: string }> | undefined) {
  return new Map((items ?? []).map((item) => [item.id, item.name]));
}

export function useHeldEventDetailPageController() {
  const { heldEventId = "" } = useParams<{ heldEventId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = currentInternalLocation(location);
  const backHref = sanitizeReturnTo(searchParams.get("returnTo")) ?? "/held-events";
  const detailQuery = useQuery(
    heldEventDetailQueryOptions(heldEventId, heldEventId.trim().length > 0),
  );
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions("held-event-detail"));
  const seasonsQuery = useQuery(seasonMastersQueryOptions("held-event-detail", undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions("held-event-detail", undefined));

  const {
    data: detail,
    error: detailError,
    isError: detailIsError,
    isFetching: detailIsFetching,
    isLoading: detailIsLoading,
    refetch: refetchDetail,
  } = detailQuery;
  const {
    data: gameTitlesData,
    error: gameTitlesError,
    isFetching: gameTitlesIsFetching,
    refetch: refetchGameTitles,
  } = gameTitlesQuery;
  const {
    data: mapsData,
    error: mapsError,
    isFetching: mapsIsFetching,
    refetch: refetchMaps,
  } = mapsQuery;
  const {
    data: seasonsData,
    error: seasonsError,
    isFetching: seasonsIsFetching,
    refetch: refetchSeasons,
  } = seasonsQuery;
  const matches = useMemo(
    () =>
      (detail?.matches ?? []).toSorted((left, right) => left.matchNoInEvent - right.matchNoInEvent),
    [detail?.matches],
  );
  const drafts = useMemo(
    () =>
      (detail?.drafts ?? []).toSorted(
        (left, right) =>
          (left.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) -
            (right.matchNoInEvent ?? Number.MAX_SAFE_INTEGER) ||
          right.updatedAt.localeCompare(left.updatedAt),
      ),
    [detail?.drafts],
  );
  const masterNames = useMemo<HeldEventMasterNames>(
    () => ({
      gameTitles: nameMap(gameTitlesData?.items),
      maps: nameMap(mapsData?.items),
      seasons: nameMap(seasonsData?.items),
    }),
    [gameTitlesData?.items, mapsData?.items, seasonsData?.items],
  );
  const playerRecaps = useMemo(() => buildHeldEventPlayerRecaps(matches), [matches]);
  const detailFailed = shouldShowQueryError({ error: detailError, isFetching: detailIsFetching });
  const gameTitlesFailed = shouldShowQueryError({
    error: gameTitlesError,
    isFetching: gameTitlesIsFetching,
  });
  const seasonsFailed = shouldShowQueryError({
    error: seasonsError,
    isFetching: seasonsIsFetching,
  });
  const mapsFailed = shouldShowQueryError({ error: mapsError, isFetching: mapsIsFetching });
  const failedMasterNameQueries = [
    gameTitlesFailed ? "作品名" : undefined,
    seasonsFailed ? "シーズン名" : undefined,
    mapsFailed ? "マップ名" : undefined,
  ].filter((label): label is string => Boolean(label));
  const refresh = useCallback(() => {
    void Promise.all([refetchDetail(), refetchGameTitles(), refetchSeasons(), refetchMaps()]);
  }, [refetchDetail, refetchGameTitles, refetchMaps, refetchSeasons]);
  const retryDetail = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);
  const retryMasterNames = useCallback(() => {
    const retries: Array<Promise<unknown>> = [];
    if (gameTitlesFailed) {
      retries.push(refetchGameTitles());
    }
    if (seasonsFailed) {
      retries.push(refetchSeasons());
    }
    if (mapsFailed) {
      retries.push(refetchMaps());
    }
    void Promise.all(retries);
  }, [gameTitlesFailed, mapsFailed, refetchGameTitles, refetchMaps, refetchSeasons, seasonsFailed]);
  const refreshing =
    detailIsFetching || gameTitlesIsFetching || seasonsIsFetching || mapsIsFetching;

  if (
    isInitialQueryLoading({
      data: detail,
      isFetching: detailIsFetching,
      isLoading: detailIsLoading,
    })
  ) {
    return { backHref, status: "loading" as const };
  }

  if (detailFailed && normalizeUnknownApiError(detailError).status === 404) {
    return { backHref, status: "notFound" as const };
  }

  if (
    shouldShowBlockingQueryError({
      data: detail,
      error: detailError,
      isError: detailIsError,
      isFetching: detailIsFetching,
    })
  ) {
    return { backHref, refresh, refreshing, status: "loadFailed" as const };
  }

  if (!detail || heldEventId.trim().length === 0) {
    return { backHref, refresh, refreshing, status: "loadFailed" as const };
  }

  return {
    detail,
    backHref,
    drafts,
    detailRefreshFailed: detailFailed,
    detailRefreshing: detailIsFetching,
    masterNames,
    masterNameLoadError:
      failedMasterNameQueries.length > 0 ? failedMasterNameQueries.join("・") : undefined,
    masterNamesRefreshing: gameTitlesIsFetching || seasonsIsFetching || mapsIsFetching,
    matches,
    playerRecaps,
    refresh,
    retryDetail,
    retryMasterNames,
    returnTo,
    refreshing,
    status: "ready" as const,
  };
}
