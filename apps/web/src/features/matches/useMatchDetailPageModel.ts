import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";

import type { MatchDetailPageModel } from "@/features/matches/matchDetailPageModel";
import { seriesComparisonHrefForMatch } from "@/features/matches/matchDetailViewModel";
import { useMatchDeletionCommand } from "@/features/matches/useMatchDeletionCommand";
import { useMatchFeatureAnalysis } from "@/features/matches/useMatchFeatureAnalysis";
import type { MatchNoteCommit, MatchNoteReadResult } from "@/features/matches/useMatchNoteEditor";
import { invalidateAfterMatchNoteReplaced } from "@/shared/api/cacheInvalidation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";
import {
  classifyReturnTo,
  currentInternalLocation,
  isSameResourceReturnTo,
  sanitizeReturnTo,
  withReturnTo,
} from "@/shared/navigation/returnTo";

function backLabel(returnTo: string | undefined, hasMatch: boolean): string {
  switch (classifyReturnTo(returnTo).kind) {
    case "matchList":
      return "試合一覧へ戻る";
    case "heldEventList":
      return "開催履歴へ戻る";
    case "heldEventDetail":
      return "元の開催へ戻る";
    case "seriesComparison":
      return "戦績比較へ戻る";
    case "none":
      return hasMatch ? "この開催へ戻る" : "試合一覧へ戻る";
    default:
      return "前の画面へ戻る";
  }
}

/** The detail cache owns confirmed absence; notices never decide whether old data is valid. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const rawReturnTo = searchParams.get("returnTo");
  const safeReturnTo = sanitizeReturnTo(rawReturnTo);
  const contextualReturnTo = isSameResourceReturnTo(safeReturnTo, location.pathname)
    ? undefined
    : safeReturnTo;
  const fallbackReason =
    rawReturnTo && !contextualReturnTo
      ? "元の戻り先を利用できないため、既定の移動先を表示しています。"
      : undefined;
  const detailReturnTo = currentInternalLocation(location);
  const queryClient = useQueryClient();
  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const { detail: match, navigation: adjacent, notFound } = readDetailQuery(matchQuery);
  const analysis = useMatchFeatureAnalysis(match);
  const deletion = useMatchDeletionCommand({
    contextualReturnTo,
    heldEventId: match?.heldEventId,
    matchId,
    pathname: location.pathname,
  });
  const { refetch, isFetching, isPaused, isPending, error } = matchQuery;
  const readLatest = useCallback(async (): Promise<MatchNoteReadResult> => {
    const result = await refetch();
    if (!result.isSuccess) return { kind: "failed" };
    return result.data.kind === "found"
      ? { kind: "found", match: result.data.detail }
      : { kind: "notFound" };
  }, [refetch]);
  const commitSavedNote = useCallback(
    async (saved: MatchNoteCommit): Promise<MatchNoteReadResult> => {
      await commitMatchNoteCache(queryClient, saved);
      const invalidation = invalidateAfterMatchNoteReplaced(queryClient, saved.matchId);
      const result = await readLatest();
      await invalidation;
      return result;
    },
    [queryClient, readLatest],
  );
  const retryPrimary = useCallback(() => {
    void refetch();
  }, [refetch]);
  const common = { matchId, note: { readLatest, commitSavedNote } };
  const refresh = { pending: isFetching || isPaused, run: retryPrimary };
  const terminalNavigation = {
    backHref: contextualReturnTo ?? "/matches",
    backLabel: backLabel(contextualReturnTo, false),
    fallbackReason,
  };

  if (notFound) return { ...common, kind: "notFound", navigation: terminalNavigation, refresh };
  if (!match && isPending && matchId.trim()) return { ...common, kind: "loading" };
  if (!match) return { ...common, kind: "loadFailed", navigation: terminalNavigation, refresh };

  const heldEventHref = `/held-events/${encodeURIComponent(match.heldEventId)}`;
  const backHref = contextualReturnTo ?? heldEventHref;
  const adjacentNavigation = adjacent ?? { kind: "unavailable" as const };
  return {
    ...common,
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
      backLabel: backLabel(contextualReturnTo, true),
      returnTo: contextualReturnTo,
      comparisonHref: withReturnTo(seriesComparisonHrefForMatch(match), detailReturnTo),
      editHref: withReturnTo(`/matches/${encodeURIComponent(match.matchId)}/edit`, detailReturnTo),
      exportHref: withReturnTo(
        `/exports?matchId=${encodeURIComponent(match.matchId)}`,
        detailReturnTo,
      ),
      currentHeldEventHref: isSameResourceReturnTo(backHref, heldEventHref)
        ? undefined
        : heldEventHref,
      fallbackReason,
      adjacent: adjacentNavigation,
      adjacentState:
        isFetching || isPaused
          ? "pending"
          : error
            ? "failed"
            : adjacentNavigation.kind === "unavailable"
              ? "unavailable"
              : "current",
    },
    refresh,
  };
}
