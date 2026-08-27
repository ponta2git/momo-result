import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { buildHeldEventPlayerRecaps } from "@/features/heldEvents/heldEventDetailViewModel";
import type {
  HeldEventMasterNames,
  HeldEventPlayerRecap,
} from "@/features/heldEvents/heldEventDetailViewModel";
import { heldEventOcrCaptureHref } from "@/features/heldEvents/heldEventNavigation";
import type {
  HeldEventDetailResponse,
  HeldEventDraftResponse,
  HeldEventMatchResponse,
} from "@/shared/api/heldEvents";
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
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

type RefreshModel = {
  pending: boolean;
  run: () => void;
};

type HeldEventDetailEnrichmentModel =
  | { kind: "complete" }
  | { kind: "pending" }
  | {
      fields: string[];
      kind: "warning";
      refresh: RefreshModel;
    };

type HeldEventDetailFreshnessModel = { kind: "current" } | { kind: "stale"; refresh: RefreshModel };

export type HeldEventDetailReadyPageModel = {
  enrichment: HeldEventDetailEnrichmentModel;
  event: {
    detail: HeldEventDetailResponse;
    drafts: HeldEventDraftResponse[];
    emphasizeNewMatch: boolean;
    masterNames: HeldEventMasterNames;
    matches: HeldEventMatchResponse[];
    playerRecaps: HeldEventPlayerRecap[];
  };
  freshness: HeldEventDetailFreshnessModel;
  kind: "ready";
  navigation: {
    backHref: string;
    exportHref: string;
    manualEntryHref: string;
    matchesHref: string;
    ocrCaptureHref: string;
    returnTo: string;
  };
  refresh: RefreshModel;
};

export type HeldEventDetailPageModel =
  | { kind: "loading" }
  | { kind: "notFound"; navigation: { backHref: string } }
  | {
      kind: "loadFailed";
      navigation: { backHref: string };
      refresh: RefreshModel;
    }
  | HeldEventDetailReadyPageModel;

function nameMap(items: ReadonlyArray<{ id: string; name: string }> | undefined) {
  return new Map((items ?? []).map((item) => [item.id, item.name]));
}

/** Maps the held-event resource and optional master-name enrichment into one screen contract. */
export function useHeldEventDetailPageModel(): HeldEventDetailPageModel {
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
  const failedMasterNameFields = [
    gameTitlesFailed ? "作品名" : undefined,
    seasonsFailed ? "シーズン名" : undefined,
    mapsFailed ? "マップ名" : undefined,
  ].filter((field): field is string => Boolean(field));
  const enrichmentPending =
    (gameTitlesData === undefined && gameTitlesIsFetching) ||
    (seasonsData === undefined && seasonsIsFetching) ||
    (mapsData === undefined && mapsIsFetching);
  const masterNamesRefreshing = gameTitlesIsFetching || seasonsIsFetching || mapsIsFetching;
  const refreshing = detailIsFetching || masterNamesRefreshing;
  const refresh = useCallback(() => {
    void Promise.all([refetchDetail(), refetchGameTitles(), refetchSeasons(), refetchMaps()]);
  }, [refetchDetail, refetchGameTitles, refetchMaps, refetchSeasons]);
  const retryDetail = useCallback(() => {
    void refetchDetail();
  }, [refetchDetail]);
  const retryMasterNames = useCallback(() => {
    const retries: Array<Promise<unknown>> = [];
    if (gameTitlesFailed) retries.push(refetchGameTitles());
    if (seasonsFailed) retries.push(refetchSeasons());
    if (mapsFailed) retries.push(refetchMaps());
    void Promise.all(retries);
  }, [gameTitlesFailed, mapsFailed, refetchGameTitles, refetchMaps, refetchSeasons, seasonsFailed]);

  if (
    isInitialQueryLoading({
      data: detail,
      isFetching: detailIsFetching,
      isLoading: detailIsLoading,
    })
  ) {
    return { kind: "loading" };
  }

  if (detailFailed && normalizeUnknownApiError(detailError).status === 404) {
    return { kind: "notFound", navigation: { backHref } };
  }

  if (
    heldEventId.trim().length === 0 ||
    shouldShowBlockingQueryError({
      data: detail,
      error: detailError,
      isError: detailIsError,
      isFetching: detailIsFetching,
    }) ||
    !detail
  ) {
    return {
      kind: "loadFailed",
      navigation: { backHref },
      refresh: { pending: detailIsFetching, run: retryDetail },
    };
  }

  const encodedHeldEventId = encodeURIComponent(detail.id);
  const enrichment: HeldEventDetailEnrichmentModel =
    failedMasterNameFields.length > 0
      ? {
          fields: failedMasterNameFields,
          kind: "warning",
          refresh: { pending: masterNamesRefreshing, run: retryMasterNames },
        }
      : enrichmentPending
        ? { kind: "pending" }
        : { kind: "complete" };

  return {
    enrichment,
    event: {
      detail,
      drafts,
      emphasizeNewMatch: drafts.length === 0 && matches.length === 0,
      masterNames,
      matches,
      playerRecaps,
    },
    freshness: detailFailed
      ? {
          kind: "stale",
          refresh: { pending: detailIsFetching, run: retryDetail },
        }
      : { kind: "current" },
    kind: "ready",
    navigation: {
      backHref,
      exportHref: withReturnTo(`/exports?heldEventId=${encodedHeldEventId}&format=csv`, returnTo),
      manualEntryHref: withReturnTo(`/matches/new?heldEventId=${encodedHeldEventId}`, returnTo),
      matchesHref: withReturnTo(
        `/matches?heldEventId=${encodedHeldEventId}&sort=match_no_asc`,
        returnTo,
      ),
      ocrCaptureHref: heldEventOcrCaptureHref(detail.id, returnTo),
      returnTo,
    },
    refresh: { pending: refreshing, run: refresh },
  };
}
