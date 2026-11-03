import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { MatchAchievementFields } from "@/features/matches/workspace/MatchAchievementFields";
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
  mode,
  view,
}: {
  editing: EditorBindings;
  mode: MatchWorkspaceEditorLayoutView["mode"];
  view: MatchWorkspaceEditorLayoutView["setup"];
}) {
  const values = useWorkspaceSnapshot(editing.setup);
  const interaction = useWorkspaceInteraction();
  const { masters } = useWorkspacePersistenceControls();
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
        mastersNavigation={masters}
        mode={mode}
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
    <fieldset className="min-w-0" disabled={interaction.disabled}>
      <MatchNoteField
        value={value}
        error={interaction.errorPathSet.has("noteBody")}
        onChange={editing.actions.changeNote}
      />
    </fieldset>
  );
});
const WorkspaceAchievements = memo(function WorkspaceAchievements({
  editing,
}: {
  editing: EditorBindings;
}) {
  const setup = useWorkspaceSnapshot(editing.setup);
  const values = useWorkspaceSnapshot(editing.achievements);
  const interaction = useWorkspaceInteraction();
  return (
    <MatchAchievementFields
      setup={setup}
      values={values}
      disabled={interaction.disabled}
      onChange={editing.actions.changeAchievements}
    />
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
    // Setup, notices, and the score editor are sibling sections of one form.
    <div className="grid min-w-0 gap-4">
      <WorkspaceSetup editing={editing} mode={view.mode} view={view.setup} />
      <WorkspaceRecovery />
      {view.notice ? <Notice tone={view.notice.tone}>{view.notice.message}</Notice> : null}
      {view.warnings.length > 0 ? (
        <Notice tone="warning" title="入力内容を確認してください">
          <ul className="grid list-disc gap-1 pl-4">
            {view.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {/* Side by side only once the editor area fits the 64rem score table, a 1rem gap,
          and the 32rem source panel; viewport width cannot see the page padding. */}
      <div className="@container/match-editor min-w-0">
        <div
          className={cn(
            "grid min-w-0 grid-cols-1 gap-4",
            view.sourceImagePanel
              ? "@min-[97rem]/match-editor:grid-cols-[minmax(0,1fr)_32rem]"
              : "",
          )}
        >
          <div className="order-2 grid min-w-0 gap-4 @min-[97rem]/match-editor:order-none">
            <WorkspaceScore
              editing={editing}
              onPreferImageKindChange={preferImageKind}
              onRequestSubmitFocus={onRequestSubmitFocus}
            />
            <WorkspaceAchievements editing={editing} />
            {view.mode === "edit" ? null : <WorkspaceNote editing={editing} />}
          </div>
          {/* The aside only sticks beside the editor; stacked, it scrolls with the form. */}
          <aside className="contents @min-[97rem]/match-editor:sticky @min-[97rem]/match-editor:top-(--sticky-below-nav) @min-[97rem]/match-editor:grid @min-[97rem]/match-editor:h-fit @min-[97rem]/match-editor:gap-4">
            {view.sourceImagePanel ? (
              <div className="order-1 @min-[97rem]/match-editor:order-none">
                <SourceImagePanel {...view.sourceImagePanel} preferredKind={preferredKind} />
              </div>
            ) : null}
            <div className="order-3 @min-[97rem]/match-editor:order-none">
              <WorkspaceSubmit primaryActionRef={primaryActionRef} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
