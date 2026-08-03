import { ChevronDown, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type {
  GameTitleListResponse,
  MapMasterListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";
import { fixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/shared/ui/data/Collapsible";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Card } from "@/shared/ui/layout/Card";

const inputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

type MatchSetupActions = {
  onGameTitleChange: (gameTitleId: string) => void;
  onPatchRoot: (patch: Partial<MatchFormValues>) => void;
};

type MatchSetupEventCreation = {
  draftValue: string;
  pending: boolean;
  onCreate: () => void;
  onDraftChange: (value: string) => void;
};

type MatchSetupOptions = {
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

function FieldError({ errorPathSet, path }: { errorPathSet: Set<string>; path: string }) {
  return errorPathSet.has(path) ? (
    <span className="text-xs font-semibold text-[var(--color-danger)]">未入力です</span>
  ) : null;
}

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
  const errorClass = "border-[var(--color-danger)]/70 bg-[var(--color-danger)]/10";
  const inputStateClass = (path: string) =>
    cn(inputClass, errorPathSet.has(path) ? errorClass : "");

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
          <div className="grid gap-3 lg:grid-cols-12">
            <label className="grid gap-1 lg:col-span-5">
              <span className={labelClass}>開催履歴（必須）</span>
              <select
                aria-invalid={errorPathSet.has("heldEventId")}
                className={inputStateClass("heldEventId")}
                data-validation-path="heldEventId"
                value={values.heldEventId}
                onChange={(event) => {
                  const selected = options.heldEvents.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  actions.onPatchRoot({
                    heldEventId: event.target.value,
                    matchNoInEvent: (selected?.matchCount ?? 0) + 1,
                    playedAt: selected?.heldAt ?? values.playedAt,
                  });
                }}
              >
                <option value="">未選択</option>
                {options.heldEvents.map((event) => (
                  <option key={event.id} value={event.id}>
                    {new Date(event.heldAt).toLocaleString()}（{event.matchCount}試合）
                  </option>
                ))}
              </select>
              <FieldError errorPathSet={errorPathSet} path="heldEventId" />
            </label>

            <label className="grid gap-1 lg:col-span-2">
              <span className={labelClass}>試合番号（必須）</span>
              <input
                aria-label="試合番号"
                aria-invalid={errorPathSet.has("matchNoInEvent")}
                className={inputStateClass("matchNoInEvent")}
                data-validation-path="matchNoInEvent"
                inputMode="numeric"
                type="text"
                value={Number.isFinite(values.matchNoInEvent) ? String(values.matchNoInEvent) : ""}
                onChange={(event) =>
                  actions.onPatchRoot({
                    matchNoInEvent: Number.parseInt(event.target.value.replaceAll(/\D/gu, ""), 10),
                  })
                }
              />
              <FieldError errorPathSet={errorPathSet} path="matchNoInEvent" />
            </label>

            <label className="grid gap-1 lg:col-span-5">
              <span className={labelClass}>開催日時（必須）</span>
              <input
                aria-invalid={errorPathSet.has("playedAt")}
                className={inputStateClass("playedAt")}
                data-validation-path="playedAt"
                type="datetime-local"
                value={toLocalDateTime(values.playedAt)}
                onChange={(event) => actions.onPatchRoot({ playedAt: event.target.value })}
              />
              <FieldError errorPathSet={errorPathSet} path="playedAt" />
            </label>

            <label className="grid gap-1 lg:col-span-3">
              <span className={labelClass}>作品（必須）</span>
              <select
                aria-invalid={errorPathSet.has("gameTitleId")}
                className={inputStateClass("gameTitleId")}
                data-validation-path="gameTitleId"
                value={values.gameTitleId}
                onChange={(event) => actions.onGameTitleChange(event.target.value)}
              >
                <option value="">未選択</option>
                {(options.gameTitleItems ?? []).map((gameTitle) => (
                  <option key={gameTitle.id} value={gameTitle.id}>
                    {gameTitle.name}
                  </option>
                ))}
              </select>
              <FieldError errorPathSet={errorPathSet} path="gameTitleId" />
            </label>

            <label className="grid gap-1 lg:col-span-3">
              <span className={labelClass}>シーズン（必須）</span>
              <select
                aria-invalid={errorPathSet.has("seasonMasterId")}
                className={inputStateClass("seasonMasterId")}
                data-validation-path="seasonMasterId"
                disabled={!values.gameTitleId}
                value={values.seasonMasterId}
                onChange={(event) => actions.onPatchRoot({ seasonMasterId: event.target.value })}
              >
                <option value="">未選択</option>
                {(options.seasonItems ?? []).map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
              <FieldError errorPathSet={errorPathSet} path="seasonMasterId" />
            </label>

            <label className="grid gap-1 lg:col-span-3">
              <span className={labelClass}>マップ（必須）</span>
              <select
                aria-invalid={errorPathSet.has("mapMasterId")}
                className={inputStateClass("mapMasterId")}
                data-validation-path="mapMasterId"
                disabled={!values.gameTitleId}
                value={values.mapMasterId}
                onChange={(event) => actions.onPatchRoot({ mapMasterId: event.target.value })}
              >
                <option value="">未選択</option>
                {(options.mapItems ?? []).map((mapMaster) => (
                  <option key={mapMaster.id} value={mapMaster.id}>
                    {mapMaster.name}
                  </option>
                ))}
              </select>
              <FieldError errorPathSet={errorPathSet} path="mapMasterId" />
            </label>

            <label className="grid gap-1 lg:col-span-3">
              <span className={labelClass}>オーナー（必須）</span>
              <select
                aria-invalid={errorPathSet.has("ownerMemberId")}
                className={inputStateClass("ownerMemberId")}
                data-validation-path="ownerMemberId"
                value={values.ownerMemberId}
                onChange={(event) =>
                  actions.onPatchRoot({
                    ownerMemberId: event.target.value as MatchFormValues["ownerMemberId"],
                  })
                }
              >
                {fixedMembers.map((member) => (
                  <option key={member.memberId} value={member.memberId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
              <FieldError errorPathSet={errorPathSet} path="ownerMemberId" />
            </label>
          </div>

          <details className="mt-4 border-t border-[var(--color-border)] pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">
              一覧にない開催履歴を追加する
            </summary>
            <div className="mt-3 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 md:grid-cols-[1fr_auto] md:items-end">
              <input
                className={inputClass}
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
