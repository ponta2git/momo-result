import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { matchDeletionDisabledReason } from "@/features/matches/matchDetailViewModel";
import type { MatchNoteEditor, MatchNoteEditorSource } from "@/features/matches/matchNoteModel";
import {
  MatchNoteNavigationGuard,
  MatchNoteRecovery,
  MatchNoteSection,
} from "@/features/matches/MatchNoteSection";
import { useMatchNoteEditor } from "@/features/matches/useMatchNoteEditor";

const NoteContext = createContext<MatchNoteEditor | null>(null);
const DeleteRestrictionContext = createContext<string | undefined>(undefined);

/** Lives for the keyed route, including unavailable reads; children do not subscribe to drafts. */
export function MatchNoteOwner({
  source,
  children,
}: {
  source: MatchNoteEditorSource;
  children: ReactNode;
}) {
  const editor = useMatchNoteEditor(source);
  const deleteRestriction = matchDeletionDisabledReason(editor);
  return (
    <NoteContext value={editor}>
      <DeleteRestrictionContext value={deleteRestriction}>
        <MatchNoteNavigationGuard editor={editor} />
        {children}
      </DeleteRestrictionContext>
    </NoteContext>
  );
}

function useNote() {
  const editor = useContext(NoteContext);
  if (!editor) throw new Error("Match note owner is missing");
  return editor;
}

export function MatchNotePanel() {
  return <MatchNoteSection editor={useNote()} />;
}

export function MatchNoteRecoveryPanel() {
  return <MatchNoteRecovery editor={useNote()} />;
}

/** A note edit only affects deletion when its dirty or pending eligibility changes. */
export function useMatchDeletionRestriction() {
  return useContext(DeleteRestrictionContext);
}
