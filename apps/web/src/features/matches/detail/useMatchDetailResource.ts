import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import type {
  MatchNoteCommit,
  MatchNoteEditorSource,
  MatchNoteIntent,
  MatchNoteReadResult,
  MatchNoteSaveResult,
} from "@/features/matches/note/matchNoteEditing";
import { invalidateAfterMatchNoteReplaced } from "@/shared/api/cacheInvalidation";
import { readDetailQuery } from "@/shared/api/detailReadResult";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { replaceMatchNote } from "@/shared/api/matches";
import { commitMatchNoteCache } from "@/shared/api/matchNoteCache";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { matchDetailQueryOptions } from "@/shared/api/queryOptions";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

/** Owns confirmed absence, note writes, and cached reads without deciding the editor's next step. */
export function useMatchDetailResource(matchId: string) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const query = useQuery(matchDetailQueryOptions(matchId, matchId.trim().length > 0));
  const { refetch, isFetching, isPaused, isPending } = query;
  const read = readDetailQuery(query);
  const noteWrite = useMutation({
    mutationFn: async ({ body, expectedVersion }: MatchNoteIntent) => {
      const payload = { body, expectedVersion, matchId };
      return runIdempotentMutation(
        idempotencyKeys,
        "matchDetail.replaceMatchNote",
        payload,
        (options) =>
          replaceMatchNote(
            matchId,
            { ...(body === undefined ? {} : { body }), expectedVersion },
            options,
          ),
      );
    },
  });
  const writeNote = noteWrite.mutateAsync;
  const saveNote = useCallback(
    async (intent: MatchNoteIntent): Promise<MatchNoteSaveResult> => {
      try {
        const response = await writeNote(intent);
        return { kind: "saved", commit: { ...intent, matchId, version: response.version } };
      } catch (error) {
        return normalizeUnknownApiError(error).code === "MATCH_NOTE_VERSION_CONFLICT"
          ? { kind: "conflict" }
          : { kind: "failed", message: formatApiError(error, "試合メモを保存できませんでした") };
      }
    },
    [matchId, writeNote],
  );
  const readLatest = useCallback(async (): Promise<MatchNoteReadResult> => {
    try {
      const result = await refetch();
      if (!result.isSuccess) return { kind: "failed" };
      return result.data.kind === "found"
        ? { kind: "found", match: result.data.detail }
        : { kind: "notFound" };
    } catch {
      return { kind: "failed" };
    }
  }, [refetch]);
  const commitSavedNote = useCallback(
    async (saved: MatchNoteCommit): Promise<MatchNoteReadResult> => {
      try {
        await commitMatchNoteCache(queryClient, saved);
        const invalidation = invalidateAfterMatchNoteReplaced(queryClient, saved.matchId);
        const result = await readLatest();
        await invalidation;
        return result;
      } catch {
        return { kind: "failed" };
      }
    },
    [queryClient, readLatest],
  );
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const noteSource: MatchNoteEditorSource = {
    matchId,
    match: read.detail,
    saveNote,
    readLatest,
    commitSavedNote,
  };
  return {
    ...read,
    initialPending: isPending,
    pending: isFetching || isPaused,
    noteSource,
    refresh: { pending: isFetching || isPaused, run: refresh },
  };
}
