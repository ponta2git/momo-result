import { useCallback, useRef, useState } from "react";

import type {
  MatchNoteEditor,
  MatchNoteEditorSource,
  MatchNoteIntent,
} from "@/features/matches/note/matchNoteEditing";
import {
  changeMatchNoteEditing,
  emptyMatchNoteEditingState,
  matchNoteInputView,
  prepareMatchNoteSave,
} from "@/features/matches/note/matchNoteEditing";

/** The keyed detail screen owns this hook, including while its resource is unavailable. */
export function useMatchNoteEditor({
  matchId,
  match,
  saveNote,
  readLatest,
  commitSavedNote,
}: MatchNoteEditorSource): MatchNoteEditor {
  const writePendingRef = useRef(false);
  const editingGenerationRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [editing, setEditing] = useState(emptyMatchNoteEditingState);
  const editingRef = useRef(editing);
  const applyChange = useCallback((intent: Parameters<typeof changeMatchNoteEditing>[1]) => {
    editingRef.current = changeMatchNoteEditing(editingRef.current, intent);
    setEditing(editingRef.current);
  }, []);
  const isNavigationAllowed = useCallback(
    () => !writePendingRef.current && !matchNoteInputView(editingRef.current, undefined).dirty,
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputView = matchNoteInputView(editing, match?.note);

  const completeSubmission = async (intent: MatchNoteIntent) => {
    const result = await saveNote(intent);
    writePendingRef.current = false;
    setPending(false);
    if (result.kind === "failed") {
      setErrorMessage(result.message);
      return;
    }
    if (result.kind === "conflict") {
      setRefreshing(true);
      const editingGeneration = editingGenerationRef.current;
      const latest = await readLatest();
      setRefreshing(false);
      if (editingGeneration !== editingGenerationRef.current) return;
      if (latest.kind !== "found" || latest.match.matchId !== matchId) {
        setErrorMessage(
          "最新版を取得できませんでした。入力内容を残しています。もう一度保存してください。",
        );
        return;
      }
      if (intent.body === undefined) {
        applyChange({ kind: "cancelDelete" });
        setErrorMessage(
          "試合メモが更新されているため削除できませんでした。最新版を確認して、もう一度実行してください。",
        );
        return;
      }
      applyChange({ kind: "conflict", draft: intent.body, latest: latest.match.note });
      return;
    }
    // The write is committed. The following display refresh does not block navigation.
    setErrorMessage(null);
    applyChange({ kind: "saved" });
    setSuccessMessage(intent.body === undefined ? "メモを削除しました" : "保存しました");
    setRefreshing(true);
    setRefreshFailed(false);
    const latest = await commitSavedNote(result.commit);
    setRefreshing(false);
    setRefreshFailed(latest.kind === "failed");
  };

  const cancel = () => {
    if (writePendingRef.current) return;
    editingGenerationRef.current += 1;
    setErrorMessage(null);
    applyChange({ kind: "cancel" });
  };
  const submit = (intent: MatchNoteIntent) => {
    if (writePendingRef.current || refreshing || !match) return false;
    writePendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage("");
    setRefreshFailed(false);
    void completeSubmission(intent);
    return true;
  };
  const save = () => {
    const intent = prepareMatchNoteSave(editingRef.current);
    if (intent && submit(intent)) applyChange({ kind: "retryConflict" });
  };
  const remove = () => {
    const deletion = editingRef.current.deletion;
    if (deletion) submit({ expectedVersion: deletion.version });
  };
  const retryDisplayRefresh = async () => {
    if (writePendingRef.current || refreshing) return;
    setRefreshing(true);
    const latest = await readLatest();
    setRefreshing(false);
    setRefreshFailed(latest.kind === "failed");
  };

  return {
    ...inputView,
    cancel,
    canSave: inputView.canSave && !pending && !refreshing && Boolean(match),
    changeDraft: (draft) => {
      if (!writePendingRef.current) applyChange({ kind: "changeDraft", draft });
    },
    conflict: editing.conflict
      ? { draft: editing.conflict.draft, latestBody: editing.conflict.latest.body }
      : null,
    deleteOpen: editing.deletion !== null,
    errorMessage,
    guard: {
      dirty: inputView.dirty,
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
      if (writePendingRef.current) return;
      if (match) applyChange({ kind: "requestDelete", note: match.note });
    },
    cancelDelete: () => {
      if (!writePendingRef.current) applyChange({ kind: "cancelDelete" });
    },
    savedNote: {
      body: match?.note.body,
      updatedAt: match?.note.updatedAt,
      updatedByDisplayName: match?.note.updatedByDisplayName,
    },
    successMessage,
    startEditing: () => {
      if (!match || writePendingRef.current || refreshing) return;
      editingGenerationRef.current += 1;
      setSuccessMessage("");
      setRefreshFailed(false);
      applyChange({ kind: "begin", note: match.note });
    },
  };
}
