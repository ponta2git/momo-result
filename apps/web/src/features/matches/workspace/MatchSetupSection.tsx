import { Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { MatchSetupFields } from "@/features/matches/workspace/MatchSetupFields";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleListResponse,
  MapMasterListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { TextField } from "@/shared/ui/forms/TextField";
import { Card } from "@/shared/ui/layout/Card";

export type MatchSetupActions = {
  onGameTitleChange: (gameTitleId: string) => void;
  onPatchRoot: (patch: Partial<MatchFormValues>) => void;
};

type MatchSetupEventCreation = {
  draftValue: string;
  pending: boolean;
  onCreate: () => void;
  onDraftChange: (value: string) => void;
};

export type MatchSetupOptions = {
  gameTitleItems: GameTitleListResponse["items"];
  heldEvents: HeldEventResponse[];
  mapItems: MapMasterListResponse["items"];
  seasonItems: SeasonMasterListResponse["items"];
};

type MatchSetupSectionProps = {
  actions: MatchSetupActions;
  errorPathSet: Set<string>;
  eventCreation: MatchSetupEventCreation;
  options: MatchSetupOptions;
  values: MatchFormValues;
  workspaceActions: {
    cancelDraft: {
      canCancel: boolean;
      confirmOpen: boolean;
      confirmPending: boolean;
      disabled: boolean;
      onConfirm: () => void | Promise<void>;
      onOpenChange: (open: boolean) => void;
      onTrigger: () => void;
    };
    mastersNavigation: {
      onClick: () => void;
      pending: boolean;
      show: boolean;
    };
  };
};

export function MatchSetupSection({
  actions,
  errorPathSet,
  eventCreation,
  options,
  values,
  workspaceActions,
}: MatchSetupSectionProps) {
  const selectedHeldEvent = options.heldEvents.find((event) => event.id === values.heldEventId);
  const selectedGameTitle = options.gameTitleItems?.find((item) => item.id === values.gameTitleId);
  const selectedSeason = options.seasonItems?.find((item) => item.id === values.seasonMasterId);
  const selectedMap = options.mapItems?.find((item) => item.id === values.mapMasterId);
  const contextComplete = Boolean(
    selectedHeldEvent && selectedGameTitle && selectedSeason && selectedMap && values.playedAt,
  );
  const hasErrors = errorPathSet.size > 0;
  const [editorOpen, setEditorOpen] = useState(!contextComplete);
  useEffect(() => {
    if (hasErrors) {
      setEditorOpen(true);
    }
  }, [hasErrors]);
  const contextSummary = contextComplete
    ? [
        selectedHeldEvent ? formatDateTimeLong(selectedHeldEvent.heldAt) : null,
        `第${values.matchNoInEvent}試合`,
        selectedGameTitle?.name,
        selectedSeason?.name,
        selectedMap?.name,
      ]
        .filter(Boolean)
        .join(" ・ ")
    : "必須条件を設定してください";
  return (
    <Card className="p-0 shadow-none">
      <h2 className="sr-only">保存先と試合条件</h2>
      <Disclosure
        ariaLabel={editorOpen ? "条件を閉じる" : "条件を変更"}
        keepMounted
        open={editorOpen}
        panelClassName="border-t border-[var(--color-border)] px-4 py-4"
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
        triggerClassName="rounded-none px-4 py-3"
        onOpenChange={setEditorOpen}
      >
        <MatchSetupFields
          actions={actions}
          errorPathSet={errorPathSet}
          options={options}
          values={values}
        />

        <Disclosure
          className="mt-4 border-t border-[var(--color-border)] pt-1"
          keepMounted
          panelClassName="pt-2"
          summary="一覧にない開催履歴を追加する"
          triggerClassName="px-2 text-xs text-[var(--color-text-secondary)]"
        >
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 md:grid-cols-[1fr_auto] md:items-end">
            <TextField
              label="開催日時"
              type="datetime-local"
              value={eventCreation.draftValue}
              onChange={(event) => eventCreation.onDraftChange(event.currentTarget.value)}
            />
            <Button
              disabled={!eventCreation.draftValue || eventCreation.pending}
              pending={eventCreation.pending}
              pendingLabel="作成中…"
              variant="secondary"
              onClick={eventCreation.onCreate}
            >
              作成して選択
            </Button>
          </div>
        </Disclosure>

        {workspaceActions.mastersNavigation.show || workspaceActions.cancelDraft.canCancel ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <div>
              {workspaceActions.mastersNavigation.show ? (
                <Button
                  icon={<Settings2 aria-hidden="true" className="size-4" />}
                  pending={workspaceActions.mastersNavigation.pending}
                  pendingLabel="移動中…"
                  size="sm"
                  variant="quiet"
                  onClick={workspaceActions.mastersNavigation.onClick}
                >
                  設定管理へ
                </Button>
              ) : null}
            </div>
            {workspaceActions.cancelDraft.canCancel ? (
              <AlertDialog
                cancelLabel="キャンセル"
                confirmLabel={workspaceActions.cancelDraft.confirmPending ? "削除中…" : "削除する"}
                description="この確定前の記録を削除します。元に戻せません。"
                open={workspaceActions.cancelDraft.confirmOpen}
                pending={workspaceActions.cancelDraft.confirmPending}
                title="確定前の記録を削除しますか？"
                trigger={
                  <Button
                    className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    disabled={workspaceActions.cancelDraft.disabled}
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                    size="sm"
                    variant="quiet"
                    onClick={workspaceActions.cancelDraft.onTrigger}
                  >
                    確定前の記録を削除
                  </Button>
                }
                onConfirm={workspaceActions.cancelDraft.onConfirm}
                onOpenChange={workspaceActions.cancelDraft.onOpenChange}
              />
            ) : null}
          </div>
        ) : null}
      </Disclosure>
    </Card>
  );
}
