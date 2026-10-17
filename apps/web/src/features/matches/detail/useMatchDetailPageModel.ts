import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import { buildMatchDetailPageModel } from "@/features/matches/detail/matchDetailPageModel";
import type { MatchDetailPageModel } from "@/features/matches/detail/matchDetailPageModel";
import { useMatchAnalysis } from "@/features/matches/detail/useMatchAnalysis";
import { useMatchDeletionCommand } from "@/features/matches/detail/useMatchDeletionCommand";
import type {
  MatchNoteCommit,
  MatchNoteReadResult,
} from "@/features/matches/note/matchNoteEditing";
import { invalidateAfterMatchNoteReplaced } from "@/shared/api/cacheInvalidation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";

/** Composes the route's read, analysis, deletion, and note owners into a pure screen result. */
export function useMatchDetailPageModel(): MatchDetailPageModel {
  const { matchId = "" } = useParams<{ matchId: string }>();
  const read = useMatchDetailRead(matchId);
  const analysis = useMatchAnalysis(read.detail);
  const deletion = useMatchDeletionCommand({ heldEventId: read.detail?.heldEventId, matchId });
  return buildMatchDetailPageModel({
    matchId,
    ...read,
    analysis,
    deletion,
    noteSource: { matchId, match: read.detail, ...read.notePersistence },
  });
}

/** The cache owns confirmed absence and saved notes; notices never validate cached details. */
function useMatchDetailRead(matchId: string) {
  const queryClient = useQueryClient();
  const query = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const { refetch, isFetching, isPaused, isPending } = query;
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
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    ...readDetailQuery(query),
    initialPending: isPending,
    pending: isFetching || isPaused,
    notePersistence: { readLatest, commitSavedNote },
    refresh: { pending: isFetching || isPaused, run: refresh },
  };
}
