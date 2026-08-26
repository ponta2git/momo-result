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

  const detail = detailQuery.data;
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
      gameTitles: nameMap(gameTitlesQuery.data?.items),
      maps: nameMap(mapsQuery.data?.items),
      seasons: nameMap(seasonsQuery.data?.items),
    }),
    [gameTitlesQuery.data?.items, mapsQuery.data?.items, seasonsQuery.data?.items],
  );
  const playerRecaps = useMemo(() => buildHeldEventPlayerRecaps(matches), [matches]);
  const failedMasterNameQueries = [
    shouldShowQueryError(gameTitlesQuery) ? "作品名" : undefined,
    shouldShowQueryError(seasonsQuery) ? "シーズン名" : undefined,
    shouldShowQueryError(mapsQuery) ? "マップ名" : undefined,
  ].filter((label): label is string => Boolean(label));
  const refresh = useCallback(() => {
    void Promise.all([
      detailQuery.refetch(),
      gameTitlesQuery.refetch(),
      seasonsQuery.refetch(),
      mapsQuery.refetch(),
    ]);
  }, [detailQuery, gameTitlesQuery, mapsQuery, seasonsQuery]);
  const retryDetail = useCallback(() => {
    void detailQuery.refetch();
  }, [detailQuery]);
  const retryMasterNames = useCallback(() => {
    const retries: Array<Promise<unknown>> = [];
    if (shouldShowQueryError(gameTitlesQuery)) {
      retries.push(gameTitlesQuery.refetch());
    }
    if (shouldShowQueryError(seasonsQuery)) {
      retries.push(seasonsQuery.refetch());
    }
    if (shouldShowQueryError(mapsQuery)) {
      retries.push(mapsQuery.refetch());
    }
    void Promise.all(retries);
  }, [gameTitlesQuery, mapsQuery, seasonsQuery]);
  const refreshing =
    detailQuery.isFetching ||
    gameTitlesQuery.isFetching ||
    seasonsQuery.isFetching ||
    mapsQuery.isFetching;

  if (isInitialQueryLoading(detailQuery)) {
    return { backHref, status: "loading" as const };
  }

  if (
    shouldShowQueryError(detailQuery) &&
    normalizeUnknownApiError(detailQuery.error).status === 404
  ) {
    return { backHref, status: "notFound" as const };
  }

  if (shouldShowBlockingQueryError(detailQuery)) {
    return { backHref, refresh, refreshing, status: "loadFailed" as const };
  }

  if (!detail || heldEventId.trim().length === 0) {
    return { backHref, refresh, refreshing, status: "loadFailed" as const };
  }

  return {
    detail,
    backHref,
    drafts,
    detailRefreshFailed: shouldShowQueryError(detailQuery),
    detailRefreshing: detailQuery.isFetching,
    masterNames,
    masterNameLoadError:
      failedMasterNameQueries.length > 0 ? failedMasterNameQueries.join("・") : undefined,
    masterNamesRefreshing:
      gameTitlesQuery.isFetching || seasonsQuery.isFetching || mapsQuery.isFetching,
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
