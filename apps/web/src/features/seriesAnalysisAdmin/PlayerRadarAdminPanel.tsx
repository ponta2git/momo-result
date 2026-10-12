import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  PlayerRadarAdminAction,
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { PlayerRadarCriteria } from "@/features/seriesAnalysisAdmin/PlayerRadarCriteria";
import { PlayerRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/PlayerRadarThresholdEditor";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

function CommandButton({
  action,
  label,
  pendingLabel,
  primary = false,
}: {
  action: PlayerRadarAdminAction;
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  return (
    <Button
      disabled={Boolean(action.disabledReason)}
      pending={action.pending}
      pendingLabel={pendingLabel}
      variant={primary ? "primary" : "secondary"}
      onClick={() => void action.run()}
    >
      {label}
    </Button>
  );
}

export function PlayerRadarAdminPanel({
  model,
  active = true,
  applyFinalFocus,
}: {
  model: PlayerRadarAdminModel;
  active?: boolean;
  applyFinalFocus?: (() => HTMLElement | null) | undefined;
}) {
  const editor = useRadarThresholdEditor(model);
  const currentSource = model.editing?.current;
  const candidateSource = model.editing?.candidate;
  const enteredCandidate = useRef<string | null>(null);
  useEffect(() => {
    const id = model.autoEditCandidateId;
    if (
      !active ||
      editor.active ||
      !id ||
      enteredCandidate.current === id ||
      model.candidate?.candidateId !== id ||
      model.candidate.status !== "ready" ||
      !candidateSource ||
      model.editing?.saveDisabledReason
    )
      return;
    enteredCandidate.current = id;
    editor.begin(candidateSource);
  }, [
    active,
    candidateSource,
    editor,
    model.autoEditCandidateId,
    model.candidate,
    model.editing?.saveDisabledReason,
  ]);
  const applyDisabledReason =
    model.applyDisabledReason ??
    (editor.active && !editor.canApply ? "入力した境界の確認が必要です。" : null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const applyTriggerRef = useRef<HTMLButtonElement>(null);
  const withdrawTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<
    | (PlayerRadarApplyTarget & {
        basisId: string;
        basis: PlayerRadarBasis;
        gameTitleName: string;
      })
    | null
  >(null);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  if (previousActive !== active) {
    setPreviousActive(active);
    setConfirmation(null);
    setEditConfirmationOpen(false);
    setWithdrawOpen(false);
  }
  const [changeMethod, setChangeMethod] = useState<"current" | "generate" | "restore">(
    currentSource ? "current" : "generate",
  );
  const [creationDialogOpen, setCreationDialogOpen] = useState(false);
  const creationAction =
    changeMethod === "current" && currentSource
      ? {
          disabledReason: model.editing?.saveDisabledReason ?? null,
          pending: false,
          run: () => editor.begin(currentSource),
        }
      : changeMethod === "restore" && model.previousBasis
        ? model.actions.restore
        : model.actions.generate;
  const candidate = model.candidate;
  const operationInProgress =
    model.operation?.status === "pending" || model.operation?.status === "running";
  const applicationInProgress = operationInProgress && model.operation?.kind === "apply";
  const candidateActive = candidate && !["applied", "withdrawn"].includes(candidate.status);
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
    <section aria-labelledby="radar-administration-heading" className="grid min-w-0 gap-6">
      <Dialog
        open={active && creationDialogOpen && Boolean(model.creationPending)}
        onOpenChange={setCreationDialogOpen}
        title="変更案を作成しています"
        description="完了後、採点境界の編集を開きます。この画面を閉じても作成は続きます。"
      >
        <Button variant="secondary" onClick={() => setCreationDialogOpen(false)}>
          閉じて待つ
        </Button>
      </Dialog>
      <UnsavedChangesGuard
        // Recreate the router subscription after an authorization Activity resumes.
        // The input remains in this panel; an old blocked destination must not resume.
        key={model.authorizationRevision}
        description="採点境界の変更はまだ適用されていません。このページに残れば編集を続けられます。"
        model={{
          dirty: editor.active,
          navigationAllowedRef: editor.navigationAllowedRef,
          onDiscard: editor.discard,
        }}
        pending={editor.preparingApply || model.applyPending || model.communicationUnknown}
      />
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
      {model.feedback && !confirmation && !withdrawOpen ? (
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
            <CommandButton
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
            <CommandButton
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
      ) : (
        <>
          <PlayerRadarCriteria currentBasis={model.currentBasis} proposedBasis={null} />
          {model.editing && (model.editing.current || model.editing.candidate) ? (
            <div className={actionRowClass}>
              {model.editing.candidate ? (
                <Button
                  disabled={Boolean(model.editing.saveDisabledReason)}
                  variant={model.editing.current ? "secondary" : "primary"}
                  onClick={() => candidateSource && editor.begin(candidateSource)}
                >
                  変更案を編集
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      <div className="contents">
        <AlertDialog
          finalFocus={() =>
            applyFinalFocus?.() ??
            (applyTriggerRef.current?.isConnected && !applyTriggerRef.current.disabled
              ? applyTriggerRef.current
              : headingRef.current)
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
                <CommandButton
                  action={model.actions.checkOperation}
                  label="操作の状態を確認する"
                  pendingLabel="操作の状態を確認中"
                />
              ) : model.operation?.status === "failed" ? (
                <>
                  <p className={contentText.body}>{model.operation.detail}</p>
                  <CommandButton
                    action={model.actions.retry}
                    label="この処理を再試行する"
                    pendingLabel="再試行を受付中"
                  />
                </>
              ) : (
                <CommandButton
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
                  value: formatDateTimeLong(confirmation?.basis.createdAt ?? undefined, "未取得"),
                },
                {
                  id: "source",
                  label: "作成元",
                  value: confirmation
                    ? `${confirmation.basis.source.matchCount}試合・${confirmation.basis.source.heldEventCount}開催`
                    : "未取得",
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
      </div>
      {candidateActive && !editor.active ? (
        <div className="grid min-w-0 gap-4">
          <div className={actionRowClass}>
            {!editor.active ? (
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
            ) : null}
          </div>
        </div>
      ) : null}
      {!editor.active ? (
        <section aria-label="採点基準の変更" className="grid min-w-0 gap-4">
          <div className="grid max-w-2xl gap-4">
            {model.previousBasis || currentSource ? (
              <ChoiceList
                legend="変更方法"
                name="radar-change-method"
                value={changeMethod}
                onValueChange={setChangeMethod}
                disabled={
                  operationInProgress || model.communicationUnknown || creationAction.pending
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
                    description: `作品全体の${model.eligibility.matchCount}試合・${model.eligibility.heldEventCount}開催から境界を計算します。`,
                  },
                  ...(model.previousBasis
                    ? [
                        {
                          value: "restore",
                          label: "前回の基準に戻す",
                          description: `${formatDateTimeLong(model.previousBasis.appliedAt ?? undefined, "日時未取得")} 適用の基準`,
                        } as const,
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className={cn(contentText.body, readableTextWidthClass, "tabular-nums")}>
                作品全体の{model.eligibility.matchCount}試合・{model.eligibility.heldEventCount}
                開催から境界を計算します。
              </p>
            )}
            <div className="grid justify-items-start gap-1">
              <CommandButton
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
                    : changeMethod === "restore" && model.previousBasis
                      ? "前回の基準から復元"
                      : "最新の記録から作成"
                }
                pendingLabel="変更案を作成中"
                primary={!model.editing?.current}
              />
              {creationAction.disabledReason &&
              !operationInProgress &&
              !model.communicationUnknown ? (
                <p className={cn(contentText.supporting, readableTextWidthClass)}>
                  {creationAction.disabledReason}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
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
