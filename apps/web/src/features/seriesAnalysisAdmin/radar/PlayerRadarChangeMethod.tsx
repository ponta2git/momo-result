import { useState } from "react";

import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import { PlayerRadarCommandButton } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarCommandButton";
import type { RadarEditingControls } from "@/features/seriesAnalysisAdmin/radar/radarThresholdEditorModel";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

/** Keep mounted during editing so a completed creation cannot reopen a discarded edit. */
export function PlayerRadarChangeMethod({
  administration,
  editor,
  active,
}: {
  administration: PlayerRadarAdministrationView;
  editor: RadarEditingControls;
  active: boolean;
}) {
  const currentSource = editor.currentSourceAvailable;
  const [changeMethod, setChangeMethod] = useState<"current" | "generate" | "restore">(
    currentSource ? "current" : "generate",
  );
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const creationAction =
    changeMethod === "current" && currentSource
      ? {
          disabledReason: editor.saveDisabledReason,
          pending: false,
          run: editor.beginFromCurrent,
        }
      : changeMethod === "restore" && administration.previousBasis
        ? administration.actions.restore
        : administration.actions.generate;
  const operationInProgress =
    administration.operation?.status === "pending" ||
    administration.operation?.status === "running";

  return (
    <>
      <Dialog
        open={active && creationDialogOpen && Boolean(administration.creationPending)}
        onOpenChange={setCreationDialogOpen}
        title="変更案を作成しています"
        description="完了後、採点境界の編集を開きます。この画面を閉じても作成は続きます。"
      >
        <Button variant="secondary" onClick={() => setCreationDialogOpen(false)}>
          閉じて待つ
        </Button>
      </Dialog>
      {editor.active ? null : (
        <section aria-label="採点基準の変更" className="grid min-w-0 gap-4">
          <div className="grid max-w-2xl gap-4">
            {administration.previousBasis || currentSource ? (
              <ChoiceList
                legend="変更方法"
                name="radar-change-method"
                value={changeMethod}
                onValueChange={setChangeMethod}
                disabled={
                  operationInProgress ||
                  administration.communicationUnknown ||
                  creationAction.pending
                }
                options={[
                  ...(currentSource
                    ? [
                        {
                          value: "current" as const,
                          label: "適用中の基準を調整",
                        },
                      ]
                    : []),
                  {
                    value: "generate",
                    label: "最新の記録から作り直す",
                    description: `作品全体の${administration.eligibility.matchCount}試合・${administration.eligibility.heldEventCount}開催から境界を計算します。`,
                  },
                  ...(administration.previousBasis
                    ? [
                        {
                          value: "restore",
                          label: "前回の基準に戻す",
                          description: `${formatDateTimeLong(administration.previousBasis.appliedAt ?? undefined, "日時未取得")} 適用の基準`,
                        } as const,
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className={cn(contentText.body, readableTextWidthClass, "tabular-nums")}>
                作品全体の{administration.eligibility.matchCount}試合・
                {administration.eligibility.heldEventCount}
                開催から境界を計算します。
              </p>
            )}
            <div className="grid justify-items-start gap-1">
              <PlayerRadarCommandButton
                action={{
                  ...creationAction,
                  run: () => {
                    setCreationDialogOpen(changeMethod !== "current");
                    return creationAction.run();
                  },
                }}
                label={
                  changeMethod === "current" && currentSource
                    ? "調整を始める"
                    : changeMethod === "restore" && administration.previousBasis
                      ? "前回の基準から復元"
                      : "最新の記録から作成"
                }
                pendingLabel="変更案を作成中"
                primary={!editor.currentSourceAvailable}
              />
              {creationAction.disabledReason &&
              !operationInProgress &&
              !administration.communicationUnknown ? (
                <p className={cn(contentText.supporting, readableTextWidthClass)}>
                  {creationAction.disabledReason}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
