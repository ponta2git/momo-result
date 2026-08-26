import type { Ref } from "react";

import { MatchFormActions } from "@/features/matches/workspace/MatchFormActions";
import { MatchSetupSection } from "@/features/matches/workspace/MatchSetupSection";
import { MatchWorkspaceRecoveryNotice } from "@/features/matches/workspace/MatchWorkspaceRecoveryNotice";
import { ScoreGrid } from "@/features/matches/workspace/scoreGrid/ScoreGrid";
import { SourceImagePanel } from "@/features/matches/workspace/sourceImages/SourceImagePanel";
import type { MatchWorkspaceController } from "@/features/matches/workspace/useMatchWorkspaceController";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";

type MatchWorkspaceEditorProps = {
  editor: MatchWorkspaceController["editor"];
  formActions: MatchWorkspaceController["formActions"];
  primaryActionRef: Ref<HTMLButtonElement>;
  setup: MatchWorkspaceController["setup"];
  onRequestSubmitFocus: () => void;
};

export function MatchWorkspaceEditor({
  editor,
  formActions,
  primaryActionRef,
  setup,
  onRequestSubmitFocus,
}: MatchWorkspaceEditorProps) {
  const setupActions = {
    onGameTitleChange: setup.onGameTitleChange,
    onPatchRoot: setup.onPatchRoot,
  };
  const setupEventCreation = {
    draftValue: setup.eventDraftValue,
    error: setup.eventCreationError,
    pending: setup.createEventPending,
    onCreate: setup.onCreateEvent,
    onDraftChange: setup.onEventDraftChange,
  };
  const setupOptions = {
    gameTitleItems: setup.gameTitleItems,
    heldEventPicker: setup.heldEventPicker,
    heldEvents: setup.heldEvents,
    mapItems: setup.mapItems,
    seasonItems: setup.seasonItems,
  };
  const scoreGridActions = {
    ...editor.scoreGrid.actions,
    onRequestSubmitFocus,
  };

  return (
    <>
      <MatchSetupSection
        actions={setupActions}
        errorPathSet={setup.errorPathSet}
        eventCreation={setupEventCreation}
        options={setupOptions}
        values={setup.values}
        workspaceActions={setup.workspaceActions}
      />

      {editor.sessionRecovery ? <MatchWorkspaceRecoveryNotice {...editor.sessionRecovery} /> : null}

      {editor.warnings.length > 0 ? (
        <Notice tone="warning" title="入力内容を確認してください">
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {editor.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          editor.sourceImagePanel ? "2xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]" : "",
        )}
      >
        <div className="order-2 min-w-0 2xl:order-none">
          <ScoreGrid actions={scoreGridActions} data={editor.scoreGrid.data} />
        </div>

        <aside className="contents 2xl:sticky 2xl:top-4 2xl:grid 2xl:h-fit 2xl:gap-4">
          {editor.sourceImagePanel ? (
            <div className="order-1 2xl:order-none">
              <SourceImagePanel {...editor.sourceImagePanel} />
            </div>
          ) : null}
          <div className="order-3 2xl:order-none">
            <MatchFormActions {...formActions} primaryActionRef={primaryActionRef} />
          </div>
        </aside>
      </div>
    </>
  );
}
