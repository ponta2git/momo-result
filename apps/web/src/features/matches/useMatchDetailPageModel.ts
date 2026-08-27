import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import { resolvedEnrichmentName } from "@/features/matches/matchDetailPageModel";
import type {
  MatchDetailEnrichmentModel,
  MatchDetailPageModel,
} from "@/features/matches/matchDetailPageModel";
import {
  nextMatchDetailSort,
  seriesComparisonHrefForMatch,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { useMatchDeletionCommand } from "@/features/matches/useMatchDeletionCommand";
import { useMatchFeatureAnalysis } from "@/features/matches/useMatchFeatureAnalysis";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

/** Owns the primary match resource and optional display enrichment for the detail screen. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const fallbackBackHref = contextualReturnTo ?? "/matches";
  const detailReturnTo = currentInternalLocation(location);
  const [sort, setSort] = useState<MatchDetailSortState>({
    key: "member",
    direction: "asc",
  });

  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const heldEventsQuery = useQuery(heldEventDirectoryQueryOptions());
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions("match-detail"));
  const seasonsQuery = useQuery(seasonMastersQueryOptions("match-detail", undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions("match-detail", undefined));

  const {
    data: match,
    error: matchError,
    isError: matchIsError,
    isFetching: matchIsFetching,
    isLoading: matchIsLoading,
    refetch: refetchMatch,
  } = matchQuery;
  const {
    data: heldEventsData,
    error: heldEventsError,
    isFetching: heldEventsIsFetching,
    refetch: refetchHeldEvents,
  } = heldEventsQuery;
  const {
    data: gameTitlesData,
    error: gameTitlesError,
    isFetching: gameTitlesIsFetching,
    refetch: refetchGameTitles,
  } = gameTitlesQuery;
  const {
    data: seasonsData,
    error: seasonsError,
    isFetching: seasonsIsFetching,
    refetch: refetchSeasons,
  } = seasonsQuery;
  const {
    data: mapsData,
    error: mapsError,
    isFetching: mapsIsFetching,
    refetch: refetchMaps,
  } = mapsQuery;

  const analysis = useMatchFeatureAnalysis(match);
  const deletion = useMatchDeletionCommand({
    contextualReturnTo,
    heldEventId: match?.heldEventId,
    matchId,
    pathname: location.pathname,
  });

  const sourcePlayers = useMemo(() => match?.players ?? [], [match?.players]);
  const players = useMemo(() => sortMatchDetailPlayers(sourcePlayers, sort), [sourcePlayers, sort]);
  const setSortKey = useCallback((key: MatchDetailSortKey) => {
    setSort((current) => nextMatchDetailSort(current, key));
  }, []);

  const matchFailed = shouldShowQueryError({ error: matchError, isFetching: matchIsFetching });
  const heldEventsFailed = shouldShowQueryError({
    error: heldEventsError,
    isFetching: heldEventsIsFetching,
  });
  const gameTitlesFailed = shouldShowQueryError({
    error: gameTitlesError,
    isFetching: gameTitlesIsFetching,
  });
  const seasonsFailed = shouldShowQueryError({
    error: seasonsError,
    isFetching: seasonsIsFetching,
  });
  const mapsFailed = shouldShowQueryError({ error: mapsError, isFetching: mapsIsFetching });
  const failedEnrichmentFields = [
    heldEventsFailed ? "開催日" : undefined,
    gameTitlesFailed ? "作品名" : undefined,
    seasonsFailed ? "シーズン名" : undefined,
    mapsFailed ? "マップ名" : undefined,
  ].filter((field): field is string => Boolean(field));
  const enrichmentPending =
    (heldEventsData === undefined && heldEventsIsFetching) ||
    (gameTitlesData === undefined && gameTitlesIsFetching) ||
    (seasonsData === undefined && seasonsIsFetching) ||
    (mapsData === undefined && mapsIsFetching);
  const enrichmentRefreshing =
    heldEventsIsFetching || gameTitlesIsFetching || seasonsIsFetching || mapsIsFetching;
  const retryEnrichment = useCallback(() => {
    const retries: Array<Promise<unknown>> = [];
    if (heldEventsFailed) retries.push(refetchHeldEvents());
    if (gameTitlesFailed) retries.push(refetchGameTitles());
    if (seasonsFailed) retries.push(refetchSeasons());
    if (mapsFailed) retries.push(refetchMaps());
    void Promise.all(retries);
  }, [
    gameTitlesFailed,
    heldEventsFailed,
    mapsFailed,
    refetchGameTitles,
    refetchHeldEvents,
    refetchMaps,
    refetchSeasons,
    seasonsFailed,
  ]);
  const retryPrimary = useCallback(() => {
    void refetchMatch();
  }, [refetchMatch]);

  if (
    isInitialQueryLoading({
      data: match,
      isFetching: matchIsFetching,
      isLoading: matchIsLoading,
    })
  ) {
    return { kind: "loading" };
  }

  if (matchFailed && normalizeUnknownApiError(matchError).status === 404) {
    return { kind: "notFound", navigation: { backHref: fallbackBackHref } };
  }

  if (
    matchId.trim().length === 0 ||
    shouldShowBlockingQueryError({
      data: match,
      error: matchError,
      isError: matchIsError,
      isFetching: matchIsFetching,
    }) ||
    !match
  ) {
    return {
      kind: "loadFailed",
      navigation: { backHref: fallbackBackHref },
      refresh: { pending: matchIsFetching, run: retryPrimary },
    };
  }

  const heldEvent = (heldEventsData?.items ?? []).find((event) => event.id === match.heldEventId);
  const gameTitle = (gameTitlesData?.items ?? []).find((item) => item.id === match.gameTitleId);
  const season = (seasonsData?.items ?? []).find((item) => item.id === match.seasonMasterId);
  const map = (mapsData?.items ?? []).find((item) => item.id === match.mapMasterId);
  const enrichment: MatchDetailEnrichmentModel =
    failedEnrichmentFields.length > 0
      ? {
          fields: failedEnrichmentFields,
          kind: "warning",
          refresh: { pending: enrichmentRefreshing, run: retryEnrichment },
        }
      : enrichmentPending
        ? { kind: "pending" }
        : { kind: "complete" };
  const backHref = contextualReturnTo ?? `/held-events/${encodeURIComponent(match.heldEventId)}`;

  return {
    analysis: {
      comparisonContextStatus: analysis.comparisonContextStatus,
      featureView: analysis.featureView,
      needsManualRefresh: analysis.needsManualRefresh,
      performanceContext: analysis.performanceContext,
      refresh: {
        pending: analysis.analysisRefreshing,
        run: analysis.refreshAnalysis,
      },
    },
    deletion,
    enrichment,
    identity: {
      gameTitle: resolvedEnrichmentName({
        failed: gameTitlesFailed,
        loading: gameTitlesData === undefined && gameTitlesIsFetching,
        name: gameTitle?.name,
      }),
      heldAt: heldEvent?.heldAt ?? match.playedAt,
      map: resolvedEnrichmentName({
        failed: mapsFailed,
        loading: mapsData === undefined && mapsIsFetching,
        name: map?.name,
      }),
      season: resolvedEnrichmentName({
        failed: seasonsFailed,
        loading: seasonsData === undefined && seasonsIsFetching,
        name: season?.name,
      }),
    },
    kind: "ready",
    match,
    navigation: {
      backHref,
      backLabel: contextualReturnTo?.startsWith("/analytics/series")
        ? "戦績比較へ戻る"
        : contextualReturnTo?.startsWith("/matches")
          ? "試合一覧へ戻る"
          : "この開催へ戻る",
      comparisonHref: withReturnTo(seriesComparisonHrefForMatch(match), detailReturnTo),
      editHref: withReturnTo(`/matches/${encodeURIComponent(match.matchId)}/edit`, detailReturnTo),
      exportHref: withReturnTo(
        `/exports?matchId=${encodeURIComponent(match.matchId)}`,
        detailReturnTo,
      ),
    },
    results: { players, setSortKey, sort },
  };
}
