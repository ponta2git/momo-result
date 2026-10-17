import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { PlayerRadarChangeMethod } from "@/features/seriesAnalysisAdmin/PlayerRadarChangeMethod";
import { PlayerRadarCommandButton } from "@/features/seriesAnalysisAdmin/PlayerRadarCommandButton";
import { PlayerRadarCriteria } from "@/features/seriesAnalysisAdmin/PlayerRadarCriteria";
import { PlayerRadarEditingWorkspace } from "@/features/seriesAnalysisAdmin/PlayerRadarEditingWorkspace";
import {
  RadarThresholdEditingOwner,
  useRadarEditingControls,
} from "@/features/seriesAnalysisAdmin/RadarThresholdEditingOwner";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type Props = {
  model: PlayerRadarAdminModel;
  active?: boolean;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
};

export function PlayerRadarAdminPanel({ model, active = true, applyFinalFocus }: Props) {
  return (
    <RadarThresholdEditingOwner model={model} active={active}>
      <PlayerRadarAdminPanelContent
        model={model}
        active={active}
        applyFinalFocus={applyFinalFocus}
      />
    </RadarThresholdEditingOwner>
  );
}

function PlayerRadarAdminPanelContent({ model, active = true, applyFinalFocus }: Props) {
  const editor = useRadarEditingControls();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const withdrawTriggerRef = useRef<HTMLButtonElement>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    setWithdrawOpen(false);
  }
  const candidate = model.candidate;
  const operationInProgress =
    model.operation?.status === "pending" || model.operation?.status === "running";
  const applicationInProgress = operationInProgress && model.operation?.kind === "apply";
  const candidateActive = candidate && !["applied", "withdrawn"].includes(candidate.status);

  return (
    <section aria-labelledby="radar-administration-heading" className="grid min-w-0 gap-6">
      <ContentWithActions
        actions={
          <Button
            disabled={Boolean(model.actions.refresh.disabledReason)}
            icon={<RefreshCw />}
            pending={model.actions.refresh.pending}
            pendingLabel="状態を更新中"
            size="sm"
            variant="secondary"
            onClick={() => void model.actions.refresh.run()}
          >
            基準の状態を更新
          </Button>
        }
      >
        <div className="grid min-w-0 gap-1">
          <h2 className="sr-only" id="radar-administration-heading" ref={headingRef} tabIndex={-1}>
            採点境界
          </h2>
          <p className={cn(contentText.supporting, "tabular-nums")}>
            {model.currentBasis
              ? `適用日時: ${formatDateTimeLong(model.currentBasis.appliedAt ?? undefined, "日時未取得")}`
              : "採点基準は未適用です。"}
          </p>
        </div>
      </ContentWithActions>
      {model.feedback && !withdrawOpen ? (
        model.feedback.tone === "success" ? (
          <p className={contentText.body} role="status">
            {model.feedback.title}
          </p>
        ) : (
          <Notice tone={model.feedback.tone} title={model.feedback.title}>
            {model.feedback.detail}
          </Notice>
        )
      ) : null}
      {model.communicationUnknown ? (
        <Notice
          title="操作の受付結果をまだ確認できません"
          tone="warning"
          action={
            <PlayerRadarCommandButton
              action={model.actions.checkOperation}
              label="操作の状態を確認する"
              pendingLabel="操作の状態を確認中"
            />
          }
        >
          {null}
        </Notice>
      ) : operationInProgress && model.operation ? (
        <p className={contentText.body} role="status">
          {model.operation.title}
        </p>
      ) : model.operation?.status === "failed" ? (
        <Notice
          title={model.operation.title}
          tone="danger"
          action={
            <PlayerRadarCommandButton
              action={model.actions.retry}
              label="この処理を再試行する"
              pendingLabel="再試行を受付中"
            />
          }
        >
          <p>{model.operation.detail}</p>
          {model.actions.retry.disabledReason ? <p>{model.actions.retry.disabledReason}</p> : null}
        </Notice>
      ) : null}
      {candidateActive ? (
        <>
          {candidate.status === "invalid" ? (
            <Notice title="この変更案は適用できません" tone="warning">
              {candidate.failureMessage ??
                "変更案を作った記録が変更されました。変更案を取り下げ、最新の記録から作り直してください。"}
            </Notice>
          ) : null}
          {candidate.status === "unavailable" && !candidate.manuallyEdited ? (
            <Notice title="採点基準を作れませんでした" tone="info">
              <ul className="grid gap-1">
                {candidate.unavailableAxes.map((axis) => (
                  <li key={axis.axisId}>
                    {playerRadarAxes.find((definition) => definition.id === axis.axisId)?.label}:{" "}
                    {axis.reason}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </>
      ) : null}
      <PlayerRadarEditingWorkspace
        model={model}
        active={active}
        applyFinalFocus={applyFinalFocus}
      />
      {!editor.active ? (
        <>
          <PlayerRadarCriteria currentBasis={model.currentBasis} proposedBasis={null} />
          {editor.candidateSourceAvailable ? (
            <div className={actionRowClass}>
              <Button
                disabled={Boolean(editor.saveDisabledReason)}
                variant={editor.currentSourceAvailable ? "secondary" : "primary"}
                onClick={editor.beginFromCandidate}
              >
                変更案を編集
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {candidateActive && !editor.active ? (
        <div className="grid min-w-0 gap-4">
          <div className={actionRowClass}>
            <AlertDialog
              finalFocus={() =>
                withdrawTriggerRef.current?.isConnected && !withdrawTriggerRef.current.disabled
                  ? withdrawTriggerRef.current
                  : headingRef.current
              }
              open={active && withdrawOpen}
              onOpenChange={setWithdrawOpen}
              confirmLabel={applicationInProgress ? "適用を取り下げる" : "変更案を取り下げる"}
              pendingLabel="取り下げを受付中"
              description={
                applicationInProgress
                  ? "公開前であれば、適用を取り消します。"
                  : "この変更案を破棄します。適用中の採点基準は変わりません。"
              }
              formatError={radarCommandErrorMessage}
              pending={model.actions.withdraw.pending}
              confirmDisabled={Boolean(model.actions.withdraw.disabledReason)}
              title={
                applicationInProgress
                  ? "この基準の適用を取り下げますか？"
                  : "この変更案を取り下げますか？"
              }
              trigger={
                <Button
                  disabled={Boolean(model.actions.withdraw.disabledReason)}
                  ref={withdrawTriggerRef}
                  variant="quiet"
                >
                  {applicationInProgress ? "適用を取り下げる" : "変更案を取り下げる"}
                </Button>
              }
              onConfirm={async () => {
                await model.actions.withdraw.run();
              }}
            />
          </div>
        </div>
      ) : null}
      <PlayerRadarChangeMethod model={model} editor={editor} active={active} />
      {model.review.reasons.length > 0 || model.review.explanation ? (
        <section aria-labelledby="radar-review-heading" className="grid min-w-0 gap-4">
          <div className="grid gap-2">
            <h3 className={contentText.heading} id="radar-review-heading">
              見直しの目安
            </h3>
            {model.review.explanation ? (
              <p className={cn(contentText.body, readableTextWidthClass, "text-pretty")}>
                {model.review.explanation}
              </p>
            ) : null}
          </div>
          {model.review.reasons.length > 0 ? (
            <ul className="grid gap-4">
              {model.review.reasons.map((reason) => (
                <li key={reason.evidenceKey}>
                  <ContentWithActions
                    actions={
                      reason.acknowledged ? (
                        <span className={contentText.supporting}>
                          {model.currentBasis ? "現在の基準を継続" : "確認済み"}
                        </span>
                      ) : (
                        <Button
                          disabled={
                            operationInProgress ||
                            model.communicationUnknown ||
                            model.actions.refresh.disabledReason !== null
                          }
                          size="sm"
                          variant="quiet"
                          onClick={() => model.actions.acknowledge(reason.evidenceKey)}
                        >
                          {model.currentBasis
                            ? "この目安を確認し、基準を継続"
                            : "この目安を確認済みにする"}
                        </Button>
                      )
                    }
                  >
                    <div className="grid min-w-0 gap-2">
                      <p className={cn(contentText.body, readableTextWidthClass)}>{reason.label}</p>
                      {reason.evidence.length > 0 ? (
                        <FactList
                          ariaLabel="見直しの根拠"
                          items={reason.evidence.map((entry) => ({
                            id: entry.label,
                            label: entry.label,
                            value: entry.value,
                          }))}
                        />
                      ) : null}
                    </div>
                  </ContentWithActions>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
