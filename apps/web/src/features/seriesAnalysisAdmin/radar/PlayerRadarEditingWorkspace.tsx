import { useRef } from "react";

import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminPresentation";
import type { PlayerRadarAdministrationView } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import { PlayerRadarCommandButton } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarCommandButton";
import { PlayerRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/radar/PlayerRadarThresholdEditor";
import { useRadarEditingWorkspace } from "@/features/seriesAnalysisAdmin/radar/RadarThresholdEditorProvider";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

/** Keep the confirmation mounted through acceptance so it can return focus to the destination. */
export function PlayerRadarEditingWorkspace({
  administration,
  active,
  applyFinalFocus,
}: {
  administration: PlayerRadarAdministrationView;
  active: boolean;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
}) {
  const editor = useRadarEditingWorkspace();
  const applyTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmation = editor.confirmation;

  return (
    <>
      {editor.active ? (
        <PlayerRadarThresholdEditor
          editor={editor}
          active={active}
          administration={administration}
          applyButtonRef={applyTriggerRef}
          onApply={editor.requestApply}
        />
      ) : null}
      <AlertDialog
        finalFocus={() =>
          applyFinalFocus?.() ??
          (applyTriggerRef.current?.isConnected && !applyTriggerRef.current.disabled
            ? applyTriggerRef.current
            : document.getElementById("radar-administration-heading"))
        }
        open={confirmation.open}
        onOpenChange={editor.setConfirmationOpen}
        confirmDisabled={confirmation.disabled}
        confirmLabel="作品全体に適用する"
        pendingLabel="適用を受付中"
        description={`${confirmation.gameTitleName}の全シーズン・全マップに適用します。過去の成績もこの基準で再採点します。`}
        formatError={radarCommandErrorMessage}
        pending={administration.applyPending}
        title="この基準を作品全体に適用しますか？"
        tone="primary"
        onConfirm={editor.confirmApply}
      >
        {confirmation.waitingMessage ? (
          <div className="grid gap-3">
            <p className={contentText.body} role="status">
              {confirmation.waitingMessage}
            </p>
            {administration.communicationUnknown ? (
              <PlayerRadarCommandButton
                action={administration.actions.checkOperation}
                label="操作の状態を確認する"
                pendingLabel="操作の状態を確認中"
              />
            ) : administration.operation?.status === "failed" ? (
              <>
                <p className={contentText.body}>{administration.operation.detail}</p>
                <PlayerRadarCommandButton
                  action={administration.actions.retry}
                  label="この処理を再試行する"
                  pendingLabel="再試行を受付中"
                />
              </>
            ) : (
              <PlayerRadarCommandButton
                action={administration.actions.refresh}
                label="確認結果を更新"
                pendingLabel="確認結果を更新中"
              />
            )}
          </div>
        ) : null}
        {confirmation.facts ? (
          <FactList
            ariaLabel="適用する採点基準"
            items={[
              {
                id: "created",
                label: "基準作成日時",
                value: formatDateTimeLong(confirmation.facts.createdAt ?? undefined, "未取得"),
              },
              {
                id: "source",
                label: "作成元",
                value: `${confirmation.facts.matchCount}試合・${confirmation.facts.heldEventCount}開催`,
              },
            ]}
          />
        ) : null}
        {confirmation.changed ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            比較または適用中の基準が変わりました。いったん閉じ、最新の比較を確認してください。
          </p>
        ) : null}
      </AlertDialog>
    </>
  );
}
