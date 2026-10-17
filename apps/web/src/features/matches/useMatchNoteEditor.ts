import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import type {
  MatchNoteEditor,
  MatchNoteEditorSource,
  MatchNoteIntent,
  MatchNoteReadResult,
} from "@/features/matches/matchNoteModel";
import {
  changeMatchNoteEditing,
  emptyMatchNoteEditingState,
  matchNoteInputView,
  prepareMatchNoteSave,
} from "@/features/matches/matchNoteModel";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { replaceMatchNote } from "@/shared/api/matches";
import { formatApiError, normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";

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
}: MatchNoteEditorSource): MatchNoteEditor {
  const idempotencyKeys = useIdempotencyKeyStore();
  const requestPendingRef = useRef(false);
  const editingSessionRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [state, setState] = useState(emptyMatchNoteEditingState);
  const current = useRef(state);
  const change = useCallback((intent: Parameters<typeof changeMatchNoteEditing>[1]) => {
    current.current = changeMatchNoteEditing(current.current, intent);
    setState(current.current);
  }, []);
  const isNavigationAllowed = useCallback(
    () => !requestPendingRef.current && !matchNoteInputView(current.current, undefined).dirty,
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const view = matchNoteInputView(state, match?.note);

  const finishRequest = () => {
    requestPendingRef.current = false;
    setPending(false);
  };

  const mutation = useMutation({
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
        change({ kind: "cancelDelete" });
        setErrorMessage(
          "試合メモが更新されているため削除できませんでした。最新版を確認して、もう一度実行してください。",
        );
        return;
      }
      change({ kind: "conflict", draft: variables.body, latest: latest.match.note });
    },
    onSuccess: async (response, variables) => {
      // The write is committed. The following display refresh does not block navigation.
      finishRequest();
      setErrorMessage(null);
      change({ kind: "saved" });
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
    setErrorMessage(null);
    change({ kind: "cancel" });
  };
  const submit = (intent: MatchNoteIntent) => {
    if (requestPendingRef.current || refreshing || !match) return false;
    requestPendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage("");
    setRefreshFailed(false);
    mutation.mutate(intent);
    return true;
  };
  const save = () => {
    const intent = prepareMatchNoteSave(current.current);
    if (intent && submit(intent)) change({ kind: "retryConflict" });
  };
  const remove = () => {
    const deletion = current.current.deletion;
    if (deletion) submit({ expectedVersion: deletion.version });
  };
  const retryDisplayRefresh = async () => {
    if (requestPendingRef.current || refreshing) return;
    setRefreshing(true);
    const latest = await readNoteSafely(readLatest);
    setRefreshing(false);
    setRefreshFailed(latest.kind === "failed");
  };

  return {
    ...view,
    cancel,
    canSave: view.canSave && !pending && !refreshing && Boolean(match),
    changeDraft: (draft) => {
      if (!requestPendingRef.current) change({ kind: "changeDraft", draft });
    },
    conflict: state.conflict
      ? { draft: state.conflict.draft, latestBody: state.conflict.latest.body }
      : null,
    deleteOpen: state.deletion !== null,
    errorMessage,
    guard: {
      dirty: view.dirty,
      isNavigationAllowed,
      onDiscard: cancel,
    },
    pending,
    refreshing,
    refreshFailed: refreshFailed && !match?.note.updatedAt,
    retryDisplayRefresh,
    remove,
    save,
    requestDelete: () => {
      if (requestPendingRef.current) return;
      if (match) change({ kind: "requestDelete", note: match.note });
    },
    cancelDelete: () => {
      if (!requestPendingRef.current) change({ kind: "cancelDelete" });
    },
    savedNote: {
      body: match?.note.body,
      updatedAt: match?.note.updatedAt,
      updatedByDisplayName: match?.note.updatedByDisplayName,
    },
    successMessage,
    startEditing: () => {
      if (!match || requestPendingRef.current || refreshing) return;
      editingSessionRef.current += 1;
      setSuccessMessage("");
      setRefreshFailed(false);
      change({ kind: "begin", note: match.note });
    },
  };
}
