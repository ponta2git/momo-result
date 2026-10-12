import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import type {
  PlayerRadarAdminAction,
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { PlayerRadarCriteria } from "@/features/seriesAnalysisAdmin/PlayerRadarCriteria";
import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/PlayerRadarPreview";
import { PlayerRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/PlayerRadarThresholdEditor";
import { useRadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ChoiceList } from "@/shared/ui/forms/ChoiceList";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
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
  const [readOnlyTab, setReadOnlyTab] = useState("criteria");
  const [changeMethod, setChangeMethod] = useState<"generate" | "restore">("generate");
  const creationAction =
    changeMethod === "restore" && model.previousBasis
      ? model.actions.restore
      : model.actions.generate;
  const candidate = model.candidate;
  const operationInProgress =
    model.operation?.status === "pending" || model.operation?.status === "running";
  const applicationInProgress = operationInProgress && model.operation?.kind === "apply";
  const candidateActive = candidate && !["applied", "withdrawn"].includes(candidate.status);
  const previewNeedsRebuild =
    (candidate?.status === "ready" ||
      (candidate?.manuallyEdited && ["unavailable", "failed"].includes(candidate.status))) &&
    (model.previewState === "stale" ||
      model.previewState === "none" ||
      model.previewState === "failed");
  const applyReasonExplainedByPreview =
    previewNeedsRebuild &&
    applyDisabledReason === "最新の記録で比較を計算し、内容を確認してください。";
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
          <h2
            className={contentText.heading}
            id="radar-administration-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            採点境界
          </h2>
          <p className={cn(contentText.supporting, "tabular-nums")}>
            {model.currentBasis
              ? `適用中の基準: ${formatDateTimeLong(model.currentBasis.appliedAt ?? undefined, "日時未取得")} 適用`
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
          <TabsRoot value={readOnlyTab} onValueChange={(value) => setReadOnlyTab(String(value))}>
            <TabsList aria-label="採点基準の確認" variant="underline">
              <TabsTab value="criteria">採点境界</TabsTab>
              <TabsTab value="impact">点数への影響</TabsTab>
            </TabsList>
            <TabsPanel value="criteria">
              <div className="mt-4">
                <PlayerRadarCriteria
                  currentBasis={model.currentBasis}
                  proposedBasis={candidateActive ? candidate.basis : null}
                />
              </div>
            </TabsPanel>
            <TabsPanel value="impact">
              <div className="mt-4 grid min-w-0 gap-4">
                {candidateActive ? (
                  <>
                    {previewNeedsRebuild ? (
                      <Notice
                        title={
                          model.previewState === "stale"
                            ? "比較の更新が必要です"
                            : model.previewState === "failed"
                              ? "比較を計算できませんでした"
                              : "比較は未計算です"
                        }
                        tone="info"
                        action={
                          <CommandButton
                            action={model.actions.rebuildPreview}
                            label="最新の記録で点数を再比較"
                            pendingLabel="点数を再比較中"
                            primary
                          />
                        }
                      >
                        {null}
                      </Notice>
                    ) : null}
                    {model.preview && !editor.active ? (
                      <PlayerRadarPreview
                        preview={model.preview}
                        filter={model.previewFilter}
                        updating={model.previewUpdating}
                        onSeasonChange={model.actions.selectSeason}
                        onMapChange={model.actions.selectMap}
                        onResetFilter={model.actions.resetPreviewFilter}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className={contentText.body}>
                    変更案を作成すると、点数への影響を確認できます。
                  </p>
                )}
              </div>
            </TabsPanel>
          </TabsRoot>
          {model.editing && (model.editing.current || model.editing.candidate) ? (
            <div className={actionRowClass}>
              {model.editing.current ? (
                <Button
                  disabled={Boolean(model.editing.saveDisabledReason)}
                  onClick={() => currentSource && editor.begin(currentSource)}
                >
                  適用中の基準を調整
                </Button>
              ) : null}
              {model.editing.candidate ? (
                <Button
                  disabled={Boolean(model.editing.saveDisabledReason)}
                  variant={model.editing.current ? "secondary" : "primary"}
                  onClick={() => candidateSource && editor.begin(candidateSource)}
                >
                  {candidate?.manuallyEdited ? "変更案を編集" : "この提案を調整"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {applyTarget || editor.active ? (
        <div className={editor.active ? "contents" : actionRowClass}>
          <AlertDialog
            finalFocus={() =>
              applyFinalFocus?.() ??
              (applyTriggerRef.current?.isConnected && !applyTriggerRef.current.disabled
                ? applyTriggerRef.current
                : headingRef.current)
            }
            open={active && (editConfirmationOpen || confirmation !== null)}
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
            trigger={
              !editor.active ? (
                <Button
                  disabled={Boolean(applyDisabledReason)}
                  ref={applyTriggerRef}
                  variant={applyDisabledReason ? "secondary" : "primary"}
                >
                  この変更案を適用する
                </Button>
              ) : undefined
            }
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
                        : "適用前に入力した境界をサーバーで確認しています。確認が終わるまで適用されません。")}
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
      ) : null}
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
          {applyDisabledReason &&
          applyTarget &&
          !applyReasonExplainedByPreview &&
          !operationInProgress &&
          !model.communicationUnknown ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>{applyDisabledReason}</p>
          ) : null}
        </div>
      ) : !editor.active ? (
        <section aria-labelledby="radar-change-heading" className="grid min-w-0 gap-4">
          <h3 className={contentText.heading} id="radar-change-heading">
            採点基準を変更する
          </h3>
          <div className="grid max-w-2xl gap-4">
            {model.previousBasis ? (
              <ChoiceList
                legend="変更方法"
                name="radar-change-method"
                value={changeMethod}
                onValueChange={setChangeMethod}
                disabled={
                  operationInProgress || model.communicationUnknown || creationAction.pending
                }
                options={[
                  {
                    value: "generate",
                    label: "最新の記録から作り直す",
                    description: `作品全体の${model.eligibility.matchCount}試合・${model.eligibility.heldEventCount}開催から境界を計算`,
                  },
                  {
                    value: "restore",
                    label: "前回の基準に戻す",
                    description: `${formatDateTimeLong(model.previousBasis.appliedAt ?? undefined, "日時未取得")} 適用の基準`,
                  },
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
                action={creationAction}
                label={model.previousBasis ? "変更案を作成" : "最新の記録から変更案を作成"}
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
