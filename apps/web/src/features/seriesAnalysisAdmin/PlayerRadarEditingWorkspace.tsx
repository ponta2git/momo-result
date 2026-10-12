import { useRef, useState } from "react";

import type {
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { PlayerRadarCommandButton } from "@/features/seriesAnalysisAdmin/PlayerRadarCommandButton";
import { PlayerRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/PlayerRadarThresholdEditor";
import type { RadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

/** Keep the confirmation mounted through acceptance so it can return focus to the destination. */
export function PlayerRadarEditingWorkspace({
  model,
  editor,
  active,
  applyFinalFocus,
}: {
  model: PlayerRadarAdminModel;
  editor: RadarThresholdEditor;
  active: boolean;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
}) {
  const applyDisabledReason =
    model.applyDisabledReason ??
    (editor.active && !editor.canApply ? "入力した境界の確認が必要です。" : null);
  const applyTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<
    | (PlayerRadarApplyTarget & {
        basisId: string;
        basis: PlayerRadarBasis;
        gameTitleName: string;
      })
    | null
  >(null);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    setConfirmation(null);
    setEditConfirmationOpen(false);
  }
  const candidate = model.candidate;
  const applyTarget =
    candidate?.status === "ready" && model.preview
      ? {
          gameTitleId: model.gameTitleId,
          candidateId: candidate.candidateId,
          previewId: model.preview.previewId,
          expectedCurrentBasisId: model.currentBasis?.basisId ?? null,
          basisId: model.preview.candidateBasis.basisId,
          basis: model.preview.candidateBasis,
          gameTitleName: model.gameTitleName,
        }
      : null;
  if (editConfirmationOpen && !confirmation && editor.canApply && applyTarget) {
    setConfirmation(applyTarget);
  }
  const confirmationChanged =
    confirmation &&
    (!applyTarget ||
      confirmation.gameTitleId !== applyTarget.gameTitleId ||
      confirmation.candidateId !== applyTarget.candidateId ||
      confirmation.previewId !== applyTarget.previewId ||
      confirmation.expectedCurrentBasisId !== applyTarget.expectedCurrentBasisId);

  return (
    <>
      {editor.active ? (
        <PlayerRadarThresholdEditor
          editor={editor}
          active={active}
          model={model}
          applyButtonRef={applyTriggerRef}
          onApply={async () => {
            if (!editor.parsed?.input) return editor.prepareApply();
            setConfirmation(editor.canApply ? applyTarget : null);
            setEditConfirmationOpen(true);
            if (!editor.canApply) return editor.prepareApply();
            return null;
          }}
        />
      ) : null}
      <AlertDialog
        finalFocus={() =>
          applyFinalFocus?.() ??
          (applyTriggerRef.current?.isConnected && !applyTriggerRef.current.disabled
            ? applyTriggerRef.current
            : document.getElementById("radar-administration-heading"))
        }
        open={editor.active && active && (editConfirmationOpen || confirmation !== null)}
        onOpenChange={(open) => {
          setEditConfirmationOpen(false);
          setConfirmation(open ? applyTarget : null);
        }}
        confirmDisabled={
          !confirmation || Boolean(applyDisabledReason) || Boolean(confirmationChanged)
        }
        confirmLabel="作品全体に適用する"
        pendingLabel="適用を受付中"
        description={`${confirmation?.gameTitleName ?? model.gameTitleName}の全シーズン・全マップに適用します。過去の成績もこの基準で再採点します。`}
        formatError={radarCommandErrorMessage}
        pending={model.applyPending}
        title="この基準を作品全体に適用しますか？"
        tone="primary"
        onConfirm={async () => {
          if (confirmation && !confirmationChanged) {
            const target = {
              gameTitleId: confirmation.gameTitleId,
              candidateId: confirmation.candidateId,
              previewId: confirmation.previewId,
              expectedCurrentBasisId: confirmation.expectedCurrentBasisId,
              basisId: confirmation.basisId,
            };
            await model.actions.apply(target);
            editor.finish();
          }
        }}
      >
        {editor.active && !editor.canApply ? (
          <div className="grid gap-3">
            <p className={contentText.body} role="status">
              {model.editing?.permissionReason ??
                editor.applyError ??
                (editor.formalMismatch
                  ? "比較結果が一致しません。キャンセルして入力と比較を確認してください。"
                  : editor.contextChanged || editor.comparisonChanged
                    ? "基準または比較が変わりました。キャンセルして最新の内容を確認してください。"
                    : "入力した境界を確認しています。確認が終わるまで適用されません。")}
            </p>
            {model.communicationUnknown ? (
              <PlayerRadarCommandButton
                action={model.actions.checkOperation}
                label="操作の状態を確認する"
                pendingLabel="操作の状態を確認中"
              />
            ) : model.operation?.status === "failed" ? (
              <>
                <p className={contentText.body}>{model.operation.detail}</p>
                <PlayerRadarCommandButton
                  action={model.actions.retry}
                  label="この処理を再試行する"
                  pendingLabel="再試行を受付中"
                />
              </>
            ) : (
              <PlayerRadarCommandButton
                action={model.actions.refresh}
                label="確認結果を更新"
                pendingLabel="確認結果を更新中"
              />
            )}
          </div>
        ) : null}
        {confirmation ? (
          <FactList
            ariaLabel="適用する採点基準"
            items={[
              {
                id: "created",
                label: "基準作成日時",
                value: formatDateTimeLong(confirmation.basis.createdAt ?? undefined, "未取得"),
              },
              {
                id: "source",
                label: "作成元",
                value: `${confirmation.basis.source.matchCount}試合・${confirmation.basis.source.heldEventCount}開催`,
              },
            ]}
          />
        ) : null}
        {confirmationChanged ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            比較または適用中の基準が変わりました。いったん閉じ、最新の比較を確認してください。
          </p>
        ) : null}
      </AlertDialog>
    </>
  );
}
