import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import type { MatchDetailPageModel } from "@/features/matches/matchDetailPageModel";
import { seriesComparisonHrefForMatch } from "@/features/matches/matchDetailViewModel";
import { useMatchDeletionCommand } from "@/features/matches/useMatchDeletionCommand";
import { useMatchFeatureAnalysis } from "@/features/matches/useMatchFeatureAnalysis";
import type { MatchNoteCommit, MatchNoteReadResult } from "@/features/matches/useMatchNoteEditor";
import { invalidateAfterMatchNoteReplaced } from "@/shared/api/cacheInvalidation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";
/** The detail cache owns confirmed absence; notices never decide whether old data is valid. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const queryClient = useQueryClient();
  const matchQuery = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const { detail: match, navigation: adjacent, notFound } = readDetailQuery(matchQuery);
  const analysis = useMatchFeatureAnalysis(match);
  const deletion = useMatchDeletionCommand({
    heldEventId: match?.heldEventId,
    matchId,
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
  if (notFound) return { ...common, kind: "notFound", refresh };
  if (!match && isPending && matchId.trim()) return { ...common, kind: "loading" };
  if (!match) return { ...common, kind: "loadFailed", refresh };

  const heldEventHref = `/held-events/${encodeURIComponent(match.heldEventId)}`;
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
      comparisonHref: seriesComparisonHrefForMatch(match),
      editHref: `/matches/${encodeURIComponent(match.matchId)}/edit`,
      exportHref: `/exports?matchId=${encodeURIComponent(match.matchId)}`,
      heldEventHref,
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
