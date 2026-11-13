import { Settings2 } from "lucide-react";
import { useState } from "react";

import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupFields } from "@/features/matches/workspace/MatchSetupFields";
import type {
  MatchWorkspaceMastersNavigationView,
  MatchWorkspaceSetupSectionView,
} from "@/features/matches/workspace/matchWorkspacePanelViews";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextField } from "@/shared/ui/forms/TextField";
import { contentText, fieldText } from "@/shared/ui/typography";

type MatchSetupSectionProps = {
  mastersNavigation: MatchWorkspaceMastersNavigationView;
  mode: WorkspaceMode;
  view: MatchWorkspaceSetupSectionView;
};

export function MatchSetupSection({ mastersNavigation, mode, view }: MatchSetupSectionProps) {
  const { options, values } = view.fields;
  const selectedHeldEvent = options.heldEvents.find((event) => event.id === values.heldEventId);
  const selectedGameTitle = options.gameTitleItems?.find((item) => item.id === values.gameTitleId);
  const selectedSeason = options.seasonItems?.find((item) => item.id === values.seasonMasterId);
  const selectedMap = options.mapItems?.find((item) => item.id === values.mapMasterId);
  const contextComplete = Boolean(
    selectedHeldEvent && selectedGameTitle && selectedSeason && selectedMap && values.playedAt,
  );
  // Names that are still being fetched are not missing input; show what is known meanwhile.
  const contextPending =
    !contextComplete &&
    (Boolean(options.mastersPending) ||
      (Boolean(values.heldEventId) &&
        !selectedHeldEvent &&
        Boolean(options.heldEventPicker?.pending)));
  const contextIncomplete = !contextComplete && !contextPending;
  const hasErrors = Object.keys(values).some((path) =>
    view.fields.validation.errorPathSet.has(path),
  );
  // A new match starts by choosing its conditions. Review and edit inherit conditions chosen
  // earlier, so the summary suffices until loaded values turn out incomplete or invalid; the
  // decision waits for pending names so a warm or cold cache opens the same way.
  const [editorOpen, setEditorOpen] = useState(mode === "create" || contextIncomplete || hasErrors);
  const [previousIncomplete, setPreviousIncomplete] = useState(contextIncomplete);
  const [previousHasErrors, setPreviousHasErrors] = useState(hasErrors);
  const focusRequest = view.fields.validation.focusRequest;
  const [handledFocusRequest, setHandledFocusRequest] = useState(focusRequest);
  if (focusRequest && handledFocusRequest !== focusRequest) {
    setHandledFocusRequest(focusRequest);
    if (focusRequest.path in values) setEditorOpen(true);
  }
  if (previousIncomplete !== contextIncomplete) {
    setPreviousIncomplete(contextIncomplete);
    if (contextIncomplete) setEditorOpen(true);
  }
  if (previousHasErrors !== hasErrors) {
    setPreviousHasErrors(hasErrors);
    if (hasErrors) setEditorOpen(true);
  }
  // Conditions still to choose are not an error until the user tries to proceed (UI rule:
  // 準備不足は操作を試みる前から error として示さない); until then the summary names them.
  const missingConditions = [
    selectedHeldEvent ? null : "開催",
    selectedGameTitle ? null : "作品",
    selectedSeason ? null : "シーズン",
    selectedMap ? null : "マップ",
  ].filter(Boolean);
  const contextSummary =
    contextIncomplete && hasErrors
      ? "必須条件を設定してください"
      : [
          selectedHeldEvent ? formatDateTimeLong(selectedHeldEvent.heldAt) : null,
          formatMatchNoInEvent(values.matchNoInEvent),
          selectedGameTitle?.name,
          selectedSeason?.name,
          selectedMap?.name,
          contextIncomplete && missingConditions.length > 0
            ? `未選択：${missingConditions.join("・")}`
            : null,
        ]
          .filter(Boolean)
          .join("・");
  return (
    <section>
      <h2 className="sr-only">保存先と試合条件</h2>
      <Disclosure
        ariaLabel={editorOpen ? "条件を閉じる" : "条件を変更"}
        keepMounted
        open={editorOpen}
        panelPadding="none"
        panelSpacing="md"
        summary={
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="grid min-w-0 flex-1 gap-1">
              <span className={contentText.heading}>保存先と試合条件</span>
              <span
                className={cn(
                  "tabular-nums",
                  hasErrors ? fieldText.error : cn(contentText.supporting, "truncate"),
                )}
                title={contextSummary}
              >
                {contextSummary}
              </span>
            </span>
            <span className={cn(contentText.body, "shrink-0")}>
              {editorOpen ? "条件を閉じる" : "条件を変更"}
            </span>
          </span>
        }
        onOpenChange={setEditorOpen}
      >
        <div className="grid gap-4">
          <MatchSetupFields view={view.fields} />

          <Disclosure
            keepMounted
            panelSpacing="sm"
            summary="一覧にない開催を追加する"
            triggerVariant="supporting"
          >
            <div className="grid gap-2">
              <div
                className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end"
                data-held-event-creation-fields=""
              >
                <TextField
                  label="開催日時"
                  type="datetime-local"
                  value={view.eventCreation.input.value}
                  onChange={(event) => view.eventCreation.input.onChange(event.currentTarget.value)}
                />
                <Button
                  disabled={!view.eventCreation.input.value || view.eventCreation.action.pending}
                  pending={view.eventCreation.action.pending}
                  pendingLabel="作成中…"
                  variant="secondary"
                  onClick={view.eventCreation.action.onCreate}
                >
                  作成して選択
                </Button>
              </div>
              {view.eventCreation.feedback.error ? (
                <Notice title={view.eventCreation.feedback.error.title} tone="danger">
                  <div className="grid gap-1">
                    <p>{view.eventCreation.feedback.error.detail}</p>
                    <p>{view.eventCreation.feedback.error.nextStep}</p>
                  </div>
                </Notice>
              ) : null}
            </div>
          </Disclosure>

          {mastersNavigation.show ? (
            <div>
              <Button
                icon={<Settings2 aria-hidden="true" />}
                pending={mastersNavigation.pending}
                pendingLabel="移動中…"
                size="sm"
                variant="quiet"
                onClick={mastersNavigation.onNavigate}
              >
                設定管理へ
              </Button>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </section>
  );
}
