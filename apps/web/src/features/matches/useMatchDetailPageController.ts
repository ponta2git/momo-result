import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  buildMatchFeatureBadges,
  nextMatchDetailSort,
  rankMatchDetailPlayers,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { invalidateAfterMatchDeleted } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { deleteMatch } from "@/shared/api/matches";
import { formatApiError } from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventsQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
  seriesComparisonAggregateQueryOptions,
} from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { buildMatchPerformanceContext } from "@/shared/domain/matchPerformanceContext";

export function useMatchDetailPageController() {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sort, setSort] = useState<MatchDetailSortState>({
    key: "playOrder",
    direction: "asc",
  });

  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));

  const heldEventsQuery = useQuery(heldEventsQueryOptions("", 100, "all"));
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
      await invalidateAfterMatchDeleted(queryClient);
      navigate("/matches", { replace: true });
    },
  });

  const match = matchQuery.data;
  const seriesComparisonQueryParams = useMemo(
    () =>
      match
        ? {
            gameTitleId: match.gameTitleId,
            mapMasterId: match.mapMasterId,
            seasonMasterId: match.seasonMasterId,
          }
        : undefined,
    [match],
  );
  const seriesComparisonQuery = useQuery(
    seriesComparisonAggregateQueryOptions(seriesComparisonQueryParams),
  );
  const scopedSeriesComparison = useMemo(() => {
    if (
      !match ||
      seriesComparisonQuery.isPlaceholderData ||
      !seriesComparisonQuery.data?.matchPlayerPoints?.some(
        (point) => point.matchId === match.matchId,
      )
    ) {
      return undefined;
    }
    return seriesComparisonQuery.data;
  }, [match, seriesComparisonQuery.data, seriesComparisonQuery.isPlaceholderData]);
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
  const rankedPlayers = useMemo(() => rankMatchDetailPlayers(sourcePlayers), [sourcePlayers]);
  const performanceContext = useMemo(
    () =>
      match
        ? buildMatchPerformanceContext({
            currentResults: rankedPlayers.map((player) => ({
              memberId: player.memberId,
              rank: player.rank,
              revenueManYen: player.revenueManYen,
              totalAssetsManYen: player.totalAssetsManYen,
            })),
            matchId: match.matchId,
            matchPlayerPoints: scopedSeriesComparison?.matchPlayerPoints,
          })
        : undefined,
    [match, rankedPlayers, scopedSeriesComparison?.matchPlayerPoints],
  );
  const featureBadges = useMemo(
    () =>
      match
        ? buildMatchFeatureBadges({
            match,
            seriesComparison: scopedSeriesComparison,
          })
        : [],
    [match, scopedSeriesComparison],
  );
  const comparisonContextStatus =
    scopedSeriesComparison === undefined
      ? seriesComparisonQuery.isPending ||
        seriesComparisonQuery.isFetching ||
        seriesComparisonQuery.isPlaceholderData
        ? ("loading" as const)
        : ("unavailable" as const)
      : ("ready" as const);
  const featureScopeLabel =
    scopedSeriesComparison === undefined
      ? comparisonContextStatus === "loading"
        ? "同条件内の特徴を確認中。この試合の記録は先に表示しています"
        : "比較データを利用できないため、この試合の記録から判定"
      : "同じ作品・シーズン・マップ内の比較と、この試合の記録から判定";

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

  if (detailLoading) {
    return { status: "loading" as const };
  }

  if (detailLoadFailed || !match) {
    return { status: "loadFailed" as const };
  }

  return {
    confirmDelete,
    comparisonContextStatus,
    errorMessage,
    featureBadges,
    featureScopeLabel,
    gameTitle,
    heldAt,
    isDeletePending: deleteMutation.isPending,
    map,
    match,
    players,
    performanceContext,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
    status: "ready" as const,
  };
}
