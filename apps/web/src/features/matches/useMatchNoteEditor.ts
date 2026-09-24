import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  matchNoteMaximumCharacters,
  normalizeMatchNote,
} from "@/features/matches/workspace/review/confirmMatchFormSchema";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { replaceMatchNote } from "@/shared/api/matches";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

/** A failed refresh must never expose cached data as the latest saved note. */
export type MatchNoteReadResult =
  | { kind: "found"; match: MatchDetailResponse }
  | { kind: "notFound" }
  | { kind: "failed" };

export type MatchNoteCommit = {
  matchId: string;
  expectedVersion: string;
  version: string;
  body?: string | undefined;
};

type MatchNoteEditorOptions = {
  matchId: string;
  match: MatchDetailResponse | undefined;
  readLatest: () => Promise<MatchNoteReadResult>;
  commitSavedNote: (commit: MatchNoteCommit) => Promise<MatchNoteReadResult>;
};

export type MatchNoteConflictState = {
  draft: string;
  latest: MatchDetailResponse["note"];
};

type NoteSnapshot = { body: string; version: string };
type NoteIntent = { body?: string; expectedVersion: string };

async function readNoteSafely(
  read: () => Promise<MatchNoteReadResult>,
): Promise<MatchNoteReadResult> {
  try {
    return await read();
  } catch {
    return { kind: "failed" };
  }
}

/** The keyed detail screen owns this hook, including while its resource is unavailable. */
export function useMatchNoteEditor({
  matchId,
  match,
  readLatest,
  commitSavedNote,
}: MatchNoteEditorOptions) {
  const idempotencyKeys = useIdempotencyKeyStore();
  const navigationAllowedRef = useRef(false);
  const requestPendingRef = useRef(false);
  const editingSessionRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [snapshot, setSnapshot] = useState<NoteSnapshot | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const [conflict, setConflict] = useState<MatchNoteConflictState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteSnapshot, setDeleteSnapshot] = useState<NoteSnapshot | null>(null);
  const editing = snapshot !== null;
  const draft = editing ? editingDraft : (match?.note.body ?? "");
  const normalizedDraft = normalizeMatchNote(draft);
  const count = Array.from(normalizedDraft).length;
  const tooLong = count > matchNoteMaximumCharacters;
  const dirty = snapshot !== null && normalizedDraft !== snapshot.body;

  const finishRequest = () => {
    requestPendingRef.current = false;
    setPending(false);
  };

  const mutation = useMutation({
    mutationFn: async ({ body, expectedVersion }: NoteIntent) => {
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
    onError: async (error, variables) => {
      finishRequest();
      const normalized = normalizeUnknownApiError(error);
      if (normalized.code !== "MATCH_NOTE_VERSION_CONFLICT") {
        setErrorMessage(formatApiError(error, "試合メモを保存できませんでした"));
        return;
      }
      setRefreshing(true);
      const editingSession = editingSessionRef.current;
      const latest = await readNoteSafely(readLatest);
      setRefreshing(false);
      if (editingSession !== editingSessionRef.current) return;
      if (latest.kind !== "found" || latest.match.matchId !== matchId) {
        setErrorMessage(
          "最新版を取得できませんでした。入力内容を残しています。もう一度保存してください。",
        );
        return;
      }
      if (variables.body === undefined) {
        setDeleteSnapshot(null);
        setErrorMessage(
          "試合メモが更新されているため削除できませんでした。最新版を確認して、もう一度実行してください。",
        );
        return;
      }
      setConflict({ draft: variables.body, latest: latest.match.note });
    },
    onSuccess: async (response, variables) => {
      // The write is committed. The following display refresh does not block navigation.
      finishRequest();
      setConflict(null);
      setErrorMessage(null);
      setDeleteSnapshot(null);
      setSnapshot(null);
      setEditingDraft("");
      setSuccessMessage(variables.body === undefined ? "メモを削除しました" : "保存しました");
      setRefreshing(true);
      setRefreshFailed(false);
      const latest = await readNoteSafely(() =>
        commitSavedNote({ ...variables, matchId, version: response.version }),
      );
      setRefreshing(false);
      setRefreshFailed(latest.kind === "failed");
    },
  });

  const cancel = () => {
    if (requestPendingRef.current) return;
    editingSessionRef.current += 1;
    setEditingDraft("");
    setConflict(null);
    setErrorMessage(null);
    setSnapshot(null);
  };
  const submit = (intent: NoteIntent) => {
    if (requestPendingRef.current || refreshing || !match) return;
    requestPendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage("");
    setRefreshFailed(false);
    mutation.mutate(intent);
  };
  const save = () => {
    if (!snapshot || tooLong || normalizedDraft.trim().length === 0 || (!dirty && !conflict))
      return;
    const baseline = conflict?.latest;
    if (baseline) setSnapshot({ body: baseline.body ?? "", version: baseline.version });
    submit({ body: normalizedDraft, expectedVersion: baseline?.version ?? snapshot.version });
  };
  const remove = () => {
    if (!deleteSnapshot) return;
    submit({ expectedVersion: deleteSnapshot.version });
  };
  const retryDisplayRefresh = async () => {
    if (requestPendingRef.current || refreshing) return;
    setRefreshing(true);
    const latest = await readNoteSafely(readLatest);
    setRefreshing(false);
    setRefreshFailed(latest.kind === "failed");
  };

  return {
    cancel,
    conflict,
    count,
    deleteOpen: deleteSnapshot !== null,
    dirty,
    draft,
    editing,
    errorMessage,
    navigationAllowedRef,
    normalizedDraft,
    pending,
    refreshing,
    refreshFailed: refreshFailed && !match?.note.updatedAt,
    retryDisplayRefresh,
    remove,
    save,
    setDeleteOpen: (open: boolean) => {
      if (requestPendingRef.current) return;
      setDeleteSnapshot(
        open && match ? { body: match.note.body ?? "", version: match.note.version } : null,
      );
    },
    setDraft: setEditingDraft,
    successMessage,
    startEditing: () => {
      if (!match || requestPendingRef.current || refreshing) return;
      editingSessionRef.current += 1;
      navigationAllowedRef.current = false;
      setSuccessMessage("");
      setRefreshFailed(false);
      setEditingDraft(match.note.body ?? "");
      setSnapshot({ body: match.note.body ?? "", version: match.note.version });
    },
    tooLong,
  };
}

export type MatchNoteEditor = ReturnType<typeof useMatchNoteEditor>;
