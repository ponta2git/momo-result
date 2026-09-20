import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import type { MatchDetailPageModel } from "@/features/matches/matchDetailPageModel";
import { seriesComparisonHrefForMatch } from "@/features/matches/matchDetailViewModel";
import { useMatchDeletionCommand } from "@/features/matches/useMatchDeletionCommand";
import { useMatchFeatureAnalysis } from "@/features/matches/useMatchFeatureAnalysis";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";
import { useRetryNotice } from "@/shared/lib/useRetryNotice";
import {
  currentInternalLocation,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

/** Owns the match snapshot and its independent analysis resource. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const contextualReturnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const fallbackBackHref = contextualReturnTo ?? "/matches";
  const detailReturnTo = currentInternalLocation(location);

  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const {
    data: match,
    error: matchError,
    isError: matchIsError,
    isFetching: matchIsFetching,
    isLoading: matchIsLoading,
    refetch: refetchMatch,
  } = matchQuery;
  const analysis = useMatchFeatureAnalysis(match);
  const deletion = useMatchDeletionCommand({
    contextualReturnTo,
    heldEventId: match?.heldEventId,
    matchId,
    pathname: location.pathname,
  });

  const matchFailed = useRetryNotice(
    shouldShowQueryError({ error: matchError, isFetching: matchIsFetching }),
    matchIsFetching,
    matchId,
  );
  const retryPrimary = useCallback(() => {
    void refetchMatch();
  }, [refetchMatch]);

  if (
    !matchFailed &&
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

  const backHref = contextualReturnTo ?? `/held-events/${encodeURIComponent(match.heldEventId)}`;

  return {
    analysis: {
      comparisonContextStatus: analysis.comparisonContextStatus,
      badges: analysis.badges,
      performanceContext: analysis.performanceContext,
    },
    deletion,
    identity: {
      gameTitle: match.gameTitleName ?? "未取得",
      heldAt: match.heldAt ?? match.playedAt,
      map: match.mapName ?? "未取得",
      season: match.seasonName ?? "未取得",
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
    note: { refetchMatch },
  };
}
