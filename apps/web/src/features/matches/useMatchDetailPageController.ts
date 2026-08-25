import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  buildMatchFeatureBadges,
  nextMatchDetailSort,
  seriesComparisonHrefForMatch,
  sortMatchDetailPlayers,
} from "@/features/matches/matchDetailViewModel";
import type {
  MatchDetailSortKey,
  MatchDetailSortState,
} from "@/features/matches/matchDetailViewModel";
import { invalidateAfterMatchDeleted } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { deleteMatch } from "@/shared/api/matches";
import {
  formatApiError,
  isAnalysisArtifactExpired,
  normalizeUnknownApiError,
} from "@/shared/api/problemDetails";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import {
  gameTitlesQueryOptions,
  heldEventDirectoryQueryOptions,
  mapMastersQueryOptions,
  matchDetailQueryOptions,
  seasonMastersQueryOptions,
} from "@/shared/api/queryOptions";
import {
  seriesAnalysisMatchContextQueryOptions,
  seriesAnalysisStatusQueryOptions,
} from "@/shared/api/seriesAnalysisQueryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { matchPerformanceContextFromArtifact } from "@/shared/domain/matchPerformanceContext";
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
  const handledExpiredArtifacts = useRef(new Set<string>());
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
  const analysisStatusQuery = useQuery(seriesAnalysisStatusQueryOptions(match?.gameTitleId));
  const currentArtifactId = analysisStatusQuery.data?.currentArtifact?.artifactId;
  const matchContextQueryParams = useMemo(
    () =>
      match && currentArtifactId
        ? {
            artifactId: currentArtifactId,
            gameTitleId: match.gameTitleId,
            mapMasterId: match.mapMasterId,
            matchId: match.matchId,
            seasonMasterId: match.seasonMasterId,
          }
        : undefined,
    [currentArtifactId, match],
  );
  const matchContextQuery = useQuery(
    seriesAnalysisMatchContextQueryOptions(matchContextQueryParams),
  );
  const analysisContext = useMemo(() => {
    if (
      !match ||
      !matchContextQuery.data ||
      matchContextQuery.data.artifact.artifactId !== currentArtifactId ||
      matchContextQuery.data.matchId !== match.matchId
    ) {
      return undefined;
    }
    return matchContextQuery.data;
  }, [currentArtifactId, match, matchContextQuery.data]);

  useEffect(() => {
    const artifactId = matchContextQueryParams?.artifactId;
    if (
      !artifactId ||
      handledExpiredArtifacts.current.has(artifactId) ||
      !isAnalysisArtifactExpired(matchContextQuery.error)
    ) {
      return;
    }
    handledExpiredArtifacts.current.add(artifactId);
    void analysisStatusQuery.refetch().then((result) => {
      if (result.data?.currentArtifact?.artifactId === artifactId) {
        return matchContextQuery.refetch();
      }
      return undefined;
    });
  }, [analysisStatusQuery, matchContextQuery, matchContextQueryParams?.artifactId]);
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
  const performanceContext = useMemo(
    () => matchPerformanceContextFromArtifact(analysisContext),
    [analysisContext],
  );
  const featureBadges = useMemo(
    () => buildMatchFeatureBadges({ features: analysisContext?.match?.features }),
    [analysisContext?.match?.features],
  );
  const analysisCalculationStatus = analysisStatusQuery.data?.calculation?.status;
  const analysisContextLoading =
    analysisStatusQuery.isPending ||
    analysisStatusQuery.isFetching ||
    analysisCalculationStatus === "queued" ||
    analysisCalculationStatus === "running" ||
    (matchContextQueryParams !== undefined &&
      (matchContextQuery.isPending || matchContextQuery.isFetching));
  const comparisonContextStatus =
    performanceContext === undefined
      ? analysisContextLoading
        ? ("loading" as const)
        : ("unavailable" as const)
      : ("ready" as const);
  const featureScopeLabel =
    analysisContext?.inclusion.status === "included"
      ? "同じ作品・シーズン・マップの保存済み分析成果物から表示"
      : comparisonContextStatus === "loading"
        ? "保存済み分析内の特徴を確認中。この試合の記録は先に表示しています"
        : analysisContext?.inclusion.status === "match_changed_since_artifact"
          ? "この試合は分析後に更新されたため、次の計算完了後に特徴を表示します"
          : "この試合を含む保存済み分析を利用できません";

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
      analysisStatusQuery.refetch(),
      ...(matchContextQueryParams ? [matchContextQuery.refetch()] : []),
    ]);
  }, [
    analysisStatusQuery,
    gameTitlesQuery,
    heldEventsQuery,
    mapsQuery,
    matchContextQuery,
    matchContextQueryParams,
    matchQuery,
    seasonsQuery,
  ]);
  const refreshing =
    matchQuery.isFetching ||
    heldEventsQuery.isFetching ||
    gameTitlesQuery.isFetching ||
    seasonsQuery.isFetching ||
    mapsQuery.isFetching ||
    analysisStatusQuery.isFetching ||
    matchContextQuery.isFetching;

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
    comparisonContextStatus,
    errorMessage,
    featureBadges,
    featureScopeLabel,
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
    performanceContext,
    season,
    setShowConfirm,
    setSortKey,
    showConfirm,
    sort,
    status: "ready" as const,
  };
}
