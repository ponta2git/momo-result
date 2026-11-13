import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

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
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";
import { matchWorkspaceSideBySideColumnsClass } from "@/shared/workflows/matchWorkspacePresentation";

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

type WorkspaceSection = "result" | "achievements";

/**
 * The result (scores, source image, note) and the achievements are separate views of one
 * record, so they share one form and one execution area below them. A validation request opens
 * the view that holds its field before that field takes focus.
 */
function WorkspaceSections({ editing, result }: { editing: EditorBindings; result: ReactNode }) {
  const interaction = useWorkspaceInteraction();
  const achievements = useWorkspaceSnapshot(editing.achievements);
  const [section, setSection] = useState<WorkspaceSection>("result");
  const request = interaction.validationFocusRequest;
  const [handledRequest, setHandledRequest] = useState(request);
  if (request && handledRequest !== request) {
    setHandledRequest(request);
    if (request.path.startsWith("achievements")) setSection("achievements");
    else if (request.path.startsWith("players") || request.path === "noteBody")
      setSection("result");
  }
  return (
    <TabsRoot
      value={section}
      onValueChange={(value) => {
        if (value === "result" || value === "achievements") setSection(value);
      }}
    >
      <div className="grid min-w-0 gap-4">
        <TabsList aria-label="入力する内容" variant="underline">
          <TabsTab value="result">試合結果</TabsTab>
          <TabsTab value="achievements">
            実績（任意）
            {achievements.length > 0 ? (
              <span className={cn(contentText.supporting, "ml-2 tabular-nums")}>
                {achievements.length}件
              </span>
            ) : null}
          </TabsTab>
        </TabsList>
        <TabsPanel keepMounted value="result">
          {result}
        </TabsPanel>
        <TabsPanel keepMounted value="achievements">
          <WorkspaceAchievements editing={editing} />
        </TabsPanel>
      </div>
    </TabsRoot>
  );
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
    // Setup, notices, the two views of the record, and the execution area are one form.
    <div className="grid min-w-0 gap-4">
      <WorkspaceSetup editing={editing} mode={view.mode} view={view.setup} />
      <WorkspaceRecovery />
      {view.notice ? <Notice tone={view.notice.tone}>{view.notice.message}</Notice> : null}
      {view.warnings.length > 0 ? (
        <Notice tone="warning" title="読み取り結果の注意">
          <ul className="grid list-disc gap-1 pl-4">
            {view.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <WorkspaceSections
        editing={editing}
        result={
          // Once the table reaches its one-line width beside the image, its incidents unfold.
          <div className="@container/match-editor min-w-0">
            <div
              className={cn(
                "grid min-w-0 grid-cols-1 gap-4",
                view.sourceImagePanel ? matchWorkspaceSideBySideColumnsClass : "",
              )}
            >
              <div className="order-2 grid min-w-0 gap-4 @min-[79rem]/match-editor:order-none">
                <WorkspaceScore
                  editing={editing}
                  onPreferImageKindChange={preferImageKind}
                  onRequestSubmitFocus={onRequestSubmitFocus}
                />
                {view.mode === "edit" ? null : <WorkspaceNote editing={editing} />}
              </div>
              {view.sourceImagePanel ? (
                // The image only sticks beside the editor; stacked, it scrolls with the form.
                <aside className="order-1 @min-[79rem]/match-editor:sticky @min-[79rem]/match-editor:top-(--sticky-below-nav) @min-[79rem]/match-editor:order-none @min-[79rem]/match-editor:h-fit">
                  <SourceImagePanel {...view.sourceImagePanel} preferredKind={preferredKind} />
                </aside>
              ) : null}
            </div>
          </div>
        }
      />
      {/* One execution area for both views, at the end of the form (UI rule: 末尾の実行領域). */}
      <WorkspaceSubmit primaryActionRef={primaryActionRef} />
    </div>
  );
}
