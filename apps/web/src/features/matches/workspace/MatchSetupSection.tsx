import { Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { MatchSetupFields } from "@/features/matches/workspace/MatchSetupFields";
import type {
  MatchWorkspaceCancellationModel,
  MatchWorkspaceMastersNavigationModel,
  MatchWorkspaceSetupSectionModel,
} from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { TextField } from "@/shared/ui/forms/TextField";

type MatchSetupSectionProps = {
  cancellation: MatchWorkspaceCancellationModel;
  mastersNavigation: MatchWorkspaceMastersNavigationModel;
  model: MatchWorkspaceSetupSectionModel;
};

export function MatchSetupSection({
  cancellation,
  mastersNavigation,
  model,
}: MatchSetupSectionProps) {
  const { options, values } = model.fields;
  const selectedHeldEvent = options.heldEvents.find((event) => event.id === values.heldEventId);
  const selectedGameTitle = options.gameTitleItems?.find((item) => item.id === values.gameTitleId);
  const selectedSeason = options.seasonItems?.find((item) => item.id === values.seasonMasterId);
  const selectedMap = options.mapItems?.find((item) => item.id === values.mapMasterId);
  const contextComplete = Boolean(
    selectedHeldEvent && selectedGameTitle && selectedSeason && selectedMap && values.playedAt,
  );
  const hasErrors = model.fields.validation.errorPathSet.size > 0;
  const [editorOpen, setEditorOpen] = useState(!contextComplete);
  useEffect(() => {
    if (hasErrors) {
      setEditorOpen(true);
    }
  }, [hasErrors]);
  const contextSummary = contextComplete
    ? [
        selectedHeldEvent ? formatDateTimeLong(selectedHeldEvent.heldAt) : null,
        formatMatchNoInEvent(values.matchNoInEvent),
        selectedGameTitle?.name,
        selectedSeason?.name,
        selectedMap?.name,
      ]
        .filter(Boolean)
        .join("・")
    : "必須条件を設定してください";
  return (
    <section>
      <h2 className="sr-only">保存先と試合条件</h2>
      <Disclosure
        ariaLabel={editorOpen ? "条件を閉じる" : "条件を変更"}
        keepMounted
        open={editorOpen}
        panelPadding="none"
        panelSpacing="md"
        presentation="inset"
        summary={
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                保存先と試合条件
              </span>
              <span
                className={cn(
                  "mt-0.5 block truncate text-xs tabular-nums",
                  hasErrors || !contextComplete
                    ? "font-semibold text-[var(--color-danger)]"
                    : "text-[var(--color-text-secondary)]",
                )}
                title={contextSummary}
              >
                {contextSummary}
              </span>
            </span>
            <span className="shrink-0 text-sm text-[var(--color-text-secondary)]">
              {editorOpen ? "条件を閉じる" : "条件を変更"}
            </span>
          </span>
        }
        triggerLayout="flush-horizontal"
        onOpenChange={setEditorOpen}
      >
        <MatchSetupFields model={model.fields} />

        <div className="mt-4">
          <Disclosure
            keepMounted
            panelSpacing="sm"
            summary="一覧にない開催を追加する"
            triggerLayout="compact"
            triggerVariant="compact"
          >
            <div className="grid gap-2">
              <div
                className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end"
                data-held-event-creation-fields=""
              >
                <TextField
                  label="開催日時"
                  type="datetime-local"
                  value={model.eventCreation.input.value}
                  onChange={(event) =>
                    model.eventCreation.input.onChange(event.currentTarget.value)
                  }
                />
                <Button
                  disabled={!model.eventCreation.input.value || model.eventCreation.action.pending}
                  pending={model.eventCreation.action.pending}
                  pendingLabel="作成中…"
                  variant="secondary"
                  onClick={model.eventCreation.action.onCreate}
                >
                  作成して選択
                </Button>
              </div>
              {model.eventCreation.feedback.error ? (
                <Notice title={model.eventCreation.feedback.error.title} tone="danger">
                  <p>{model.eventCreation.feedback.error.detail}</p>
                  <p className="mt-1">{model.eventCreation.feedback.error.nextStep}</p>
                </Notice>
              ) : null}
            </div>
          </Disclosure>
        </div>

        {mastersNavigation.show || cancellation.allowed || cancellation.error ? (
          <div className="mt-6 grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {mastersNavigation.show ? (
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
                ) : null}
              </div>
              {cancellation.allowed ? (
                <AlertDialog
                  cancelLabel="キャンセル"
                  confirmLabel={cancellation.dialog.pending ? "削除中…" : "削除する"}
                  description="この確定前の記録を削除します。元に戻せません。"
                  open={cancellation.dialog.open}
                  pending={cancellation.dialog.pending}
                  title="確定前の記録を削除しますか？"
                  trigger={
                    <Button
                      disabled={cancellation.disabled}
                      icon={<Trash2 aria-hidden="true" />}
                      size="sm"
                      variant="dangerQuiet"
                      onClick={cancellation.onTrigger}
                    >
                      確定前の記録を削除
                    </Button>
                  }
                  onConfirm={cancellation.dialog.onConfirm}
                  onOpenChange={cancellation.dialog.onOpenChange}
                />
              ) : null}
            </div>
            {cancellation.error ? (
              <Notice title={cancellation.error.title} tone="danger">
                <p>{cancellation.error.detail}</p>
                <p className="mt-1">{cancellation.error.nextStep}</p>
              </Notice>
            ) : null}
          </div>
        ) : null}
      </Disclosure>
    </section>
  );
}
