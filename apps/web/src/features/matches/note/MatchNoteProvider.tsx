import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { matchDeletionDisabledReason } from "@/features/matches/note/matchNoteEditing";
import type {
  MatchNoteEditor,
  MatchNoteEditorSource,
} from "@/features/matches/note/matchNoteEditing";
import {
  MatchNoteNavigationGuard,
  MatchNoteRecovery,
  MatchNoteSection,
} from "@/features/matches/note/MatchNoteSection";
import { useMatchNoteEditor } from "@/features/matches/note/useMatchNoteEditor";

const MatchNoteEditorContext = createContext<MatchNoteEditor | null>(null);
const MatchDeletionRestrictionContext = createContext<string | undefined>(undefined);

/** Lives for the keyed route, including unavailable reads; children do not subscribe to drafts. */
export function MatchNoteProvider({
  source,
  children,
}: {
  source: MatchNoteEditorSource;
  children: ReactNode;
}) {
  const editor = useMatchNoteEditor(source);
  const deletionRestriction = matchDeletionDisabledReason(editor);
  return (
    <MatchNoteEditorContext value={editor}>
      <MatchDeletionRestrictionContext value={deletionRestriction}>
        <MatchNoteNavigationGuard editor={editor} />
        {children}
      </MatchDeletionRestrictionContext>
    </MatchNoteEditorContext>
  );
}

function useMatchNoteContext() {
  const editor = useContext(MatchNoteEditorContext);
  if (!editor) throw new Error("MatchNoteProvider is missing");
  return editor;
}

export function MatchNotePanel() {
  return <MatchNoteSection editor={useMatchNoteContext()} />;
}

export function MatchNoteRecoveryPanel() {
  return <MatchNoteRecovery editor={useMatchNoteContext()} />;
}

/** A note edit only affects deletion when its dirty or pending eligibility changes. */
export function useMatchDeletionRestriction() {
  return useContext(MatchDeletionRestrictionContext);
}
