import { ChevronDown, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import {
  MatchSetupFields,
  matchSetupInputClass,
} from "@/features/matches/workspace/MatchSetupFields";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleListResponse,
  MapMasterListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/shared/ui/data/Collapsible";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
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
  const panelOpen = hasErrors || editorOpen;
  const contextSummary = contextComplete
    ? [
        selectedHeldEvent ? new Date(selectedHeldEvent.heldAt).toLocaleString() : null,
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
      <CollapsibleRoot open={panelOpen} onOpenChange={setEditorOpen}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              保存先と試合条件
            </h2>
            <p
              className={cn(
                "mt-0.5 truncate text-xs tabular-nums",
                hasErrors || !contextComplete
                  ? "font-semibold text-[var(--color-danger)]"
                  : "text-[var(--color-text-secondary)]",
              )}
              title={contextSummary}
            >
              {contextSummary}
            </p>
          </div>
          <CollapsibleTrigger className="group inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-xs)] px-2 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]">
            {panelOpen ? "条件を閉じる" : "条件を変更"}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform duration-150 group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </div>

        <CollapsiblePanel className="border-t border-[var(--color-border)] px-4 py-4" keepMounted>
          <MatchSetupFields
            actions={actions}
            errorPathSet={errorPathSet}
            options={options}
            values={values}
          />

          <details className="mt-4 border-t border-[var(--color-border)] pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">
              一覧にない開催履歴を追加する
            </summary>
            <div className="mt-3 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 md:grid-cols-[1fr_auto] md:items-end">
              <input
                className={matchSetupInputClass}
                type="datetime-local"
                value={eventCreation.draftValue}
                onChange={(event) => eventCreation.onDraftChange(event.target.value)}
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
          </details>

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
                  confirmLabel={
                    workspaceActions.cancelDraft.confirmPending ? "削除中…" : "削除する"
                  }
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
        </CollapsiblePanel>
      </CollapsibleRoot>
    </Card>
  );
}
