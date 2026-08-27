import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import {
  matchNoteMaximumCharacters,
  normalizeMatchNote,
} from "@/features/matches/workspace/review/confirmMatchFormSchema";
import { invalidateAfterMatchNoteReplaced } from "@/shared/api/cacheInvalidation";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { replaceMatchNote } from "@/shared/api/matches";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

type MatchNoteEditorOptions = {
  match: MatchDetailResponse;
  refetchMatch: () => Promise<{ data?: MatchDetailResponse | undefined }>;
};

export type MatchNoteConflictState = {
  draft: string;
  latest: MatchDetailResponse["note"];
};

export function useMatchNoteEditor({ match, refetchMatch }: MatchNoteEditorOptions) {
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const navigationAllowedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(match.note.body ?? "");
  const [conflict, setConflict] = useState<MatchNoteConflictState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const normalizedDraft = normalizeMatchNote(draft);
  const count = Array.from(normalizedDraft).length;
  const tooLong = count > matchNoteMaximumCharacters;
  const dirty = editing && normalizedDraft !== (match.note.body ?? "");

  useEffect(() => {
    if (!editing) setDraft(match.note.body ?? "");
  }, [editing, match.note.body]);

  const mutation = useMutation({
    mutationFn: async ({ body, expectedVersion }: { body?: string; expectedVersion: string }) => {
      const payload = { body, expectedVersion, matchId: match.matchId };
      return runIdempotentMutation(
        idempotencyKeys,
        "matchDetail.replaceMatchNote",
        payload,
        (options) =>
          replaceMatchNote(
            match.matchId,
            { ...(body === undefined ? {} : { body }), expectedVersion },
            options,
          ),
      );
    },
    onError: async (error, variables) => {
      const normalized = normalizeUnknownApiError(error);
      if (normalized.code !== "MATCH_NOTE_VERSION_CONFLICT") {
        setErrorMessage(formatApiError(error, "試合メモを保存できませんでした"));
        return;
      }
      const latest = await refetchMatch();
      if (!latest.data) {
        setErrorMessage(
          "最新版を取得できませんでした。通信状態を確認して、もう一度保存してください。",
        );
        return;
      }
      if (variables.body === undefined) {
        setErrorMessage(
          "試合メモが更新されているため削除できませんでした。最新版を確認して、もう一度実行してください。",
        );
        return;
      }
      setConflict({ draft: variables.body, latest: latest.data.note });
      setDraft(variables.body);
    },
    onSuccess: async () => {
      navigationAllowedRef.current = true;
      setConflict(null);
      setErrorMessage(null);
      setDeleteOpen(false);
      setEditing(false);
      await invalidateAfterMatchNoteReplaced(queryClient, match.matchId);
      navigationAllowedRef.current = false;
    },
  });

  const cancel = () => {
    setDraft(match.note.body ?? "");
    setConflict(null);
    setErrorMessage(null);
    setEditing(false);
  };
  const save = () => {
    if (tooLong || normalizedDraft.trim().length === 0) return;
    setErrorMessage(null);
    mutation.mutate({
      body: normalizedDraft,
      expectedVersion: conflict?.latest.version ?? match.note.version,
    });
  };
  const remove = () => {
    setErrorMessage(null);
    mutation.mutate({ expectedVersion: match.note.version });
  };

  return {
    cancel,
    conflict,
    count,
    deleteOpen,
    dirty,
    draft,
    editing,
    errorMessage,
    navigationAllowedRef,
    normalizedDraft,
    pending: mutation.isPending,
    remove,
    save,
    setDeleteOpen,
    setDraft,
    startEditing: () => setEditing(true),
    tooLong,
  };
}
