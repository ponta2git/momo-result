import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { MatchNoteField } from "@/features/matches/workspace/MatchNoteField";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import type { MatchWorkspaceEditorBindings } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import type { MatchWorkspaceEditorLayoutView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import {
  useWorkspaceInteraction,
  useWorkspacePersistenceControls,
} from "@/features/matches/workspace/MatchWorkspacePersistence";
import { MatchWorkspaceRecoveryNotice } from "@/features/matches/workspace/MatchWorkspaceRecoveryNotice";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useWorkspaceSnapshot } from "@/features/matches/workspace/useWorkspaceSnapshot";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";

type EditorBindings = MatchWorkspaceEditorBindings;

const WorkspaceSetup = memo(function WorkspaceSetup({
  editing,
  view,
}: {
  editing: EditorBindings;
  view: MatchWorkspaceEditorLayoutView["setup"];
}) {
  const values = useWorkspaceSnapshot(editing.setup);
  const interaction = useWorkspaceInteraction();
  const { masters, persistence } = useWorkspacePersistenceControls();
  useEffect(() => {
    const request = interaction.validationFocusRequest;
    if (!request || request.path.startsWith("players.")) return;
    const target = document.querySelector<HTMLElement>(`[data-validation-path="${request.path}"]`);
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  }, [interaction.validationFocusRequest]);
  return (
    <fieldset
      className="min-w-0"
      disabled={interaction.disabled || view.eventCreation.action.pending}
    >
      <MatchSetupSection
        cancellation={persistence.cancellation}
        mastersNavigation={masters}
        view={{
          eventCreation: view.eventCreation,
          fields: {
            values,
            actions: {
              onSelectHeldEvent: editing.actions.selectHeldEvent,
              onChangeField: editing.actions.changeSetup,
            },
            options: view.options,
            validation: {
              errorPathSet: interaction.errorPathSet,
              focusRequest: interaction.validationFocusRequest,
            },
          },
        }}
      />
    </fieldset>
  );
});
const WorkspaceScore = memo(function WorkspaceScore({
  editing,
  onPreferImageKindChange,
  onRequestSubmitFocus,
}: {
  editing: EditorBindings;
  onPreferImageKindChange: (kind: SourceImageKind) => void;
  onRequestSubmitFocus: () => void;
}) {
  const review = useWorkspaceSnapshot(editing.review);
  const interaction = useWorkspaceInteraction();
  return (
    <fieldset className="min-w-0" disabled={interaction.disabled}>
      <ScoreGrid
        actions={{
          onAcknowledgeReviewCell: editing.actions.acknowledge,
          onIncidentChange: editing.actions.changeIncident,
          onNumericDraftChange: editing.actions.changeNumericDraft,
          onPlayerChange: editing.actions.changePlayer,
          onPlayOrderChange: editing.actions.changePlayOrder,
          onPreferImageKindChange,
          onReviewCellFocus: editing.actions.focus,
          onRequestSubmitFocus,
        }}
        data={{
          rows: editing.scoreRows,
          errorPathSet: interaction.errorPathSet,
          validationFocusRequest: interaction.validationFocusRequest,
          review,
        }}
      />
    </fieldset>
  );
});
const WorkspaceNote = memo(function WorkspaceNote({ editing }: { editing: EditorBindings }) {
  const value = useWorkspaceSnapshot(editing.note);
  const interaction = useWorkspaceInteraction();
  return (
    <fieldset className="mt-4 min-w-0" disabled={interaction.disabled}>
      <MatchNoteField
        value={value}
        error={interaction.errorPathSet.has("noteBody")}
        onChange={editing.actions.changeNote}
      />
    </fieldset>
  );
});
function WorkspaceRecovery() {
  const { persistence } = useWorkspacePersistenceControls();
  return persistence.recovery ? <MatchWorkspaceRecoveryNotice view={persistence.recovery} /> : null;
}
function WorkspaceSubmit({
  primaryActionRef,
}: {
  primaryActionRef: RefObject<HTMLButtonElement | null>;
}) {
  const { persistence } = useWorkspacePersistenceControls();
  return <MatchFormActions view={persistence.submit} primaryActionRef={primaryActionRef} />;
}

export function MatchWorkspaceEditor({
  editing,
  view,
}: {
  editing: EditorBindings;
  view: MatchWorkspaceEditorLayoutView;
}) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [preferredKind, preferImageKind] = useState<SourceImageKind>("total_assets");
  const onRequestSubmitFocus = useCallback(() => {
    primaryActionRef.current?.focus();
  }, []);
  return (
    <>
      <WorkspaceSetup editing={editing} view={view.setup} />
      <WorkspaceRecovery />
      {view.notice ? <Notice tone={view.notice.tone}>{view.notice.message}</Notice> : null}
      {view.warnings.length > 0 ? (
        <Notice tone="warning" title="入力内容を確認してください">
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {view.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-4",
          view.sourceImagePanel ? "2xl:grid-cols-[minmax(0,1fr)_minmax(30rem,32rem)]" : "",
        )}
      >
        <div className="order-2 min-w-0 2xl:order-none">
          <WorkspaceScore
            editing={editing}
            onPreferImageKindChange={preferImageKind}
            onRequestSubmitFocus={onRequestSubmitFocus}
          />
          {view.mode === "edit" ? null : <WorkspaceNote editing={editing} />}
        </div>
        <aside className="contents 2xl:sticky 2xl:top-4 2xl:grid 2xl:h-fit 2xl:gap-4">
          {view.sourceImagePanel ? (
            <div className="order-1 2xl:order-none">
              <SourceImagePanel {...view.sourceImagePanel} preferredKind={preferredKind} />
            </div>
          ) : null}
          <div className="order-3 2xl:order-none">
            <WorkspaceSubmit primaryActionRef={primaryActionRef} />
          </div>
        </aside>
      </div>
    </>
  );
}
