import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  nextMatchDetailSort,
  seriesComparisonHrefForMatch,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { useMatchFeatureAnalysis } from "@/features/matches/useMatchFeatureAnalysis";
import { invalidateAfterMatchDeleted } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { deleteMatch } from "@/shared/api/matches";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

export function useMatchDetailPageController() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const detailReturnTo = currentInternalLocation(location);
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sort, setSort] = useState<MatchDetailSortState>({
    key: "member",
    direction: "asc",
  });

  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));

  const heldEventsQuery = useQuery(heldEventDirectoryQueryOptions());
  const gameTitlesQuery = useQuery(gameTitlesQueryOptions("match-detail"));
  const seasonsQuery = useQuery(seasonMastersQueryOptions("match-detail", undefined));
  const mapsQuery = useQuery(mapMastersQueryOptions("match-detail", undefined));

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const payload = { matchId };
      return runIdempotentMutation(idempotencyKeys, "matchDetail.deleteMatch", payload, (options) =>
        deleteMatch(matchId, options),
      );
    },
    onError: (error) => {
      setErrorMessage(formatApiError(error, "削除に失敗しました"));
    },
    onSuccess: async () => {
      const heldEventId = matchQuery.data?.heldEventId;
      await invalidateAfterMatchDeleted(queryClient);
      navigate(
        contextualReturnTo ??
          (heldEventId ? `/held-events/${encodeURIComponent(heldEventId)}` : "/matches"),
        { replace: true },
      );
    },
  });

  const match = matchQuery.data;
  const analysis = useMatchFeatureAnalysis(match);
  const heldEvent = match
    ? (heldEventsQuery.data?.items ?? []).find((event) => event.id === match.heldEventId)
    : undefined;
  const gameTitle = match
    ? (gameTitlesQuery.data?.items ?? []).find((item) => item.id === match.gameTitleId)
    : undefined;
  const season = match
    ? (seasonsQuery.data?.items ?? []).find((item) => item.id === match.seasonMasterId)
    : undefined;
  const map = match
    ? (mapsQuery.data?.items ?? []).find((item) => item.id === match.mapMasterId)
    : undefined;
  const heldAt = heldEvent?.heldAt ?? match?.playedAt ?? "";
  const sourcePlayers = useMemo(() => match?.players ?? [], [match?.players]);
  const players = useMemo(() => sortMatchDetailPlayers(sourcePlayers, sort), [sourcePlayers, sort]);
  const setSortKey = useCallback((key: MatchDetailSortKey) => {
    setSort((current) => nextMatchDetailSort(current, key));
  }, []);

  const confirmDelete = useCallback(async () => {
    setErrorMessage(null);
    await deleteMutation.mutateAsync();
  }, [deleteMutation]);

  const detailLoading =
    isInitialQueryLoading(matchQuery) ||
    isInitialQueryLoading(heldEventsQuery) ||
    isInitialQueryLoading(gameTitlesQuery) ||
    isInitialQueryLoading(seasonsQuery) ||
    isInitialQueryLoading(mapsQuery);
  const detailLoadFailed =
    matchId.trim().length === 0 ||
    shouldShowBlockingQueryError(matchQuery) ||
    shouldShowBlockingQueryError(heldEventsQuery) ||
    shouldShowBlockingQueryError(gameTitlesQuery) ||
    shouldShowBlockingQueryError(seasonsQuery) ||
    shouldShowBlockingQueryError(mapsQuery);
  const matchNotFound =
    shouldShowBlockingQueryError(matchQuery) &&
    normalizeUnknownApiError(matchQuery.error).status === 404;
  const refresh = useCallback(() => {
    void Promise.all([
      matchQuery.refetch(),
      heldEventsQuery.refetch(),
      gameTitlesQuery.refetch(),
      seasonsQuery.refetch(),
      mapsQuery.refetch(),
      analysis.refreshAnalysis(),
    ]);
  }, [analysis, gameTitlesQuery, heldEventsQuery, mapsQuery, matchQuery, seasonsQuery]);
  const refreshing =
    matchQuery.isFetching ||
    heldEventsQuery.isFetching ||
    gameTitlesQuery.isFetching ||
    seasonsQuery.isFetching ||
    mapsQuery.isFetching ||
    analysis.analysisRefreshing;

  if (detailLoading) {
    return { backHref: contextualReturnTo ?? "/matches", status: "loading" as const };
  }

  if (matchNotFound) {
    return { backHref: contextualReturnTo ?? "/matches", status: "notFound" as const };
  }

  if (detailLoadFailed || !match) {
    return {
      backHref: contextualReturnTo ?? "/matches",
      refresh,
      refreshing,
      status: "loadFailed" as const,
    };
  }

  const fallbackBackHref = `/held-events/${encodeURIComponent(match.heldEventId)}`;
  const backHref = contextualReturnTo ?? fallbackBackHref;

  return {
    confirmDelete,
    backHref,
    backLabel: contextualReturnTo?.startsWith("/analytics/series")
      ? "戦績比較へ戻る"
      : contextualReturnTo?.startsWith("/matches")
        ? "試合一覧へ戻る"
        : "この開催へ戻る",
    comparisonContextStatus: analysis.comparisonContextStatus,
    errorMessage,
    featureView: analysis.featureView,
    gameTitle,
    heldAt,
    isDeletePending: deleteMutation.isPending,
    editHref: withReturnTo(`/matches/${encodeURIComponent(match.matchId)}/edit`, detailReturnTo),
    exportHref: withReturnTo(
      `/exports?matchId=${encodeURIComponent(match.matchId)}`,
      detailReturnTo,
    ),
    comparisonHref: withReturnTo(seriesComparisonHrefForMatch(match), detailReturnTo),
    map,
    match,
    players,
    performanceContext: analysis.performanceContext,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
    status: "ready" as const,
  };
}
