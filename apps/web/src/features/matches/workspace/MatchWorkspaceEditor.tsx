import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { MatchNoteField } from "@/features/matches/workspace/MatchNoteField";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import type { MatchWorkspaceEditingViews } from "@/features/matches/workspace/matchWorkspaceEditingStore";
import type { MatchWorkspaceEditorLayoutModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import {
  useWorkspaceInteraction,
  useWorkspacePersistenceControls,
} from "@/features/matches/workspace/MatchWorkspacePersistence";
import { MatchWorkspaceRecoveryNotice } from "@/features/matches/workspace/MatchWorkspaceRecoveryNotice";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { useWorkspaceReadView } from "@/features/matches/workspace/useWorkspaceReadView";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";

type EditingViews = MatchWorkspaceEditingViews;

const WorkspaceSetup = memo(function WorkspaceSetup({
  editing,
  model,
}: {
  editing: EditingViews;
  model: MatchWorkspaceEditorLayoutModel["setup"];
}) {
  const values = useWorkspaceReadView(editing.setup);
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
      disabled={interaction.disabled || model.eventCreation.action.pending}
    >
      <MatchSetupSection
        cancellation={persistence.cancellation}
        mastersNavigation={masters}
        model={{
          eventCreation: model.eventCreation,
          fields: {
            values,
            actions: {
              onSelectHeldEvent: editing.actions.selectHeldEvent,
              onChangeField: editing.actions.changeSetup,
            },
            options: model.options,
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
  editing: EditingViews;
  onPreferImageKindChange: (kind: SourceImageKind) => void;
  onRequestSubmitFocus: () => void;
}) {
  const review = useWorkspaceReadView(editing.review);
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
const WorkspaceNote = memo(function WorkspaceNote({ editing }: { editing: EditingViews }) {
  const value = useWorkspaceReadView(editing.note);
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
  return persistence.recovery ? (
    <MatchWorkspaceRecoveryNotice model={persistence.recovery} />
  ) : null;
}
function WorkspaceSubmit({
  primaryActionRef,
}: {
  primaryActionRef: RefObject<HTMLButtonElement | null>;
}) {
  const { persistence } = useWorkspacePersistenceControls();
  return <MatchFormActions model={persistence.submit} primaryActionRef={primaryActionRef} />;
}

export function MatchWorkspaceEditor({
  editing,
  model,
}: {
  editing: EditingViews;
  model: MatchWorkspaceEditorLayoutModel;
}) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [preferredKind, preferImageKind] = useState<SourceImageKind>("total_assets");
  const onRequestSubmitFocus = useCallback(() => {
    primaryActionRef.current?.focus();
  }, []);
  return (
    <>
      <WorkspaceSetup editing={editing} model={model.setup} />
      <WorkspaceRecovery />
      {model.notice ? <Notice tone={model.notice.tone}>{model.notice.message}</Notice> : null}
      {model.warnings.length > 0 ? (
        <Notice tone="warning" title="入力内容を確認してください">
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {model.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-4",
          model.sourceImagePanel ? "2xl:grid-cols-[minmax(0,1fr)_minmax(30rem,32rem)]" : "",
        )}
      >
        <div className="order-2 min-w-0 2xl:order-none">
          <WorkspaceScore
            editing={editing}
            onPreferImageKindChange={preferImageKind}
            onRequestSubmitFocus={onRequestSubmitFocus}
          />
          {model.mode === "edit" ? null : <WorkspaceNote editing={editing} />}
        </div>
        <aside className="contents 2xl:sticky 2xl:top-4 2xl:grid 2xl:h-fit 2xl:gap-4">
          {model.sourceImagePanel ? (
            <div className="order-1 2xl:order-none">
              <SourceImagePanel {...model.sourceImagePanel} preferredKind={preferredKind} />
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
