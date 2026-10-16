import type { MatchDetailResponse } from "@/shared/api/matches";

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

export type MatchNoteConflictState = {
  draft: string;
  latest: MatchDetailResponse["note"];
};

export type MatchNoteEditor = {
  cancel: () => void;
  conflict: MatchNoteConflictState | null;
  count: number;
  deleteOpen: boolean;
  dirty: boolean;
  draft: string;
  editing: boolean;
  errorMessage: string | null;
  navigationAllowedRef: { current: boolean };
  normalizedDraft: string;
  pending: boolean;
  refreshing: boolean;
  refreshFailed: boolean;
  retryDisplayRefresh: () => Promise<void>;
  remove: () => void;
  save: () => void;
  setDeleteOpen: (open: boolean) => void;
  setDraft: (draft: string | ((current: string) => string)) => void;
  successMessage: string;
  startEditing: () => void;
  tooLong: boolean;
};
