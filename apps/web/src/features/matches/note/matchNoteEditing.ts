import { matchNoteMaximumCharacters, normalizeMatchNote } from "@/features/matches/matchNoteText";
import type { MatchDetailResponse } from "@/shared/api/matches";
import type { UnsavedChangesGuardModel } from "@/shared/navigation/unsavedChangesModel";

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

export type MatchNoteSaveResult =
  | { kind: "saved"; commit: MatchNoteCommit }
  | { kind: "conflict" }
  | { kind: "failed"; message: string };

type MatchNoteConflictState = {
  draft: string;
  latest: MatchDetailResponse["note"];
};

export type MatchNoteEditorSource = {
  matchId: string;
  match: MatchDetailResponse | undefined;
  saveNote: (intent: MatchNoteIntent) => Promise<MatchNoteSaveResult>;
  readLatest: () => Promise<MatchNoteReadResult>;
  commitSavedNote: (commit: MatchNoteCommit) => Promise<MatchNoteReadResult>;
};

type NoteSnapshot = { body: string; version: string };
export type MatchNoteIntent = { body?: string; expectedVersion: string };
export type MatchNoteEditingState = {
  baseline: NoteSnapshot | null;
  draft: string;
  conflict: MatchNoteConflictState | null;
  deletion: NoteSnapshot | null;
};

export const emptyMatchNoteEditingState: MatchNoteEditingState = {
  baseline: null,
  draft: "",
  conflict: null,
  deletion: null,
};

type MatchNoteChange =
  | { kind: "begin"; note: MatchDetailResponse["note"] }
  | { kind: "changeDraft"; draft: string }
  | { kind: "cancel" }
  | { kind: "conflict"; draft: string; latest: MatchDetailResponse["note"] }
  | { kind: "retryConflict" }
  | { kind: "requestDelete"; note: MatchDetailResponse["note"] }
  | { kind: "cancelDelete" }
  | { kind: "saved" };

/** Editing baselines and conflict versions move together; server cache data stays external. */
export function changeMatchNoteEditing(
  state: MatchNoteEditingState,
  change: MatchNoteChange,
): MatchNoteEditingState {
  switch (change.kind) {
    case "begin":
      return {
        ...state,
        baseline: { body: change.note.body ?? "", version: change.note.version },
        draft: change.note.body ?? "",
        conflict: null,
      };
    case "changeDraft":
      return state.baseline && state.draft !== change.draft
        ? { ...state, draft: change.draft }
        : state;
    case "cancel":
      return { ...state, baseline: null, draft: "", conflict: null };
    case "conflict":
      return { ...state, conflict: { draft: change.draft, latest: change.latest } };
    case "retryConflict":
      return state.conflict
        ? {
            ...state,
            baseline: {
              body: state.conflict.latest.body ?? "",
              version: state.conflict.latest.version,
            },
          }
        : state;
    case "requestDelete":
      return { ...state, deletion: { body: change.note.body ?? "", version: change.note.version } };
    case "cancelDelete":
      return { ...state, deletion: null };
    case "saved":
      return emptyMatchNoteEditingState;
  }
}

export function matchNoteInputView(
  state: MatchNoteEditingState,
  note: MatchDetailResponse["note"] | undefined,
) {
  const editing = state.baseline !== null;
  const draft = editing ? state.draft : (note?.body ?? "");
  const normalized = normalizeMatchNote(draft);
  const count = Array.from(normalized).length;
  const dirty = state.baseline !== null && normalized !== state.baseline.body;
  const tooLong = count > matchNoteMaximumCharacters;
  return {
    draft,
    editing,
    count,
    dirty,
    tooLong,
    canSave:
      editing && !tooLong && normalized.trim().length > 0 && (dirty || state.conflict !== null),
  };
}

export function prepareMatchNoteSave(state: MatchNoteEditingState): MatchNoteIntent | undefined {
  if (!matchNoteInputView(state, undefined).canSave || !state.baseline) return undefined;
  return {
    body: normalizeMatchNote(state.draft),
    expectedVersion: state.conflict?.latest.version ?? state.baseline.version,
  };
}

/** Display values and user operations; versions and editing snapshots never cross this boundary. */
export type MatchNoteEditor = Readonly<{
  cancel: () => void;
  canSave: boolean;
  changeDraft: (draft: string) => void;
  conflict: Readonly<{ draft: string; latestBody: string | undefined }> | null;
  count: number;
  deleteOpen: boolean;
  dirty: boolean;
  draft: string;
  editing: boolean;
  errorMessage: string | null;
  guard: UnsavedChangesGuardModel;
  pending: boolean;
  refreshing: boolean;
  refreshFailed: boolean;
  retryDisplayRefresh: () => Promise<void>;
  remove: () => void;
  save: () => void;
  requestDelete: () => void;
  cancelDelete: () => void;
  savedNote: Readonly<{
    body: string | undefined;
    updatedAt: string | undefined;
    updatedByDisplayName: string | undefined;
  }>;
  successMessage: string;
  startEditing: () => void;
  tooLong: boolean;
}>;

export function matchDeletionDisabledReason(note: { pending: boolean; dirty: boolean }) {
  return note.pending
    ? "メモの保存・削除が完了するまで、試合は削除できません。"
    : note.dirty
      ? "メモを保存するか、編集をキャンセルすると試合を削除できます。"
      : undefined;
}
