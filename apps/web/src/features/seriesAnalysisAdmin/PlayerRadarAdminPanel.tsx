import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import type {
  PlayerRadarAdminAction,
  PlayerRadarAdminModel,
  PlayerRadarApplyTarget,
} from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { radarCommandErrorMessage } from "@/features/seriesAnalysisAdmin/playerRadarAdminPresentation";
import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/PlayerRadarPreview";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { PlayerRadarBasis } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
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

export function PlayerRadarAdminPanel({ model }: { model: PlayerRadarAdminModel }) {
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
  const [withdrawOpen, setWithdrawOpen] = useState(false);
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
        <div className="grid min-w-0 gap-2">
          <h2
            className={contentText.heading}
            id="radar-administration-heading"
            ref={headingRef}
            tabIndex={-1}
          >
            レーダーの採点基準
          </h2>
          <section aria-label="適用中の基準" className="grid min-w-0">
            {model.currentBasis ? (
              <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
                {[
                  {
                    id: "applied",
                    label: "適用中",
                    value: formatDateTimeLong(model.currentBasis.appliedAt ?? undefined, "未取得"),
                  },
                  {
                    id: "created",
                    label: "作成日時",
                    value: formatDateTimeLong(model.currentBasis.createdAt ?? undefined, "未取得"),
                  },
                ].map((item) => (
                  <FactList key={item.id} ariaLabel={item.label} items={[item]} />
                ))}
              </div>
            ) : (
              <p className={cn(contentText.body, readableTextWidthClass)}>未適用です。</p>
            )}
            {model.currentBasis && (!candidateActive || !model.preview) ? (
              <Disclosure
                summary="作成元の記録"
                triggerVariant="supporting"
                triggerLayout="flush-horizontal"
              >
                <FactList
                  ariaLabel="適用中基準の作成元"
                  columns={2}
                  items={[
                    {
                      id: "sample",
                      label: "件数",
                      value: `${model.currentBasis.source.matchCount}試合・${model.currentBasis.source.heldEventCount}開催`,
                    },
                    {
                      id: "period",
                      label: "期間",
                      value:
                        model.currentBasis.source.firstPlayedAt &&
                        model.currentBasis.source.lastPlayedAt
                          ? `${formatDateTimeLong(model.currentBasis.source.firstPlayedAt)}〜${formatDateTimeLong(model.currentBasis.source.lastPlayedAt)}`
                          : "未取得",
                    },
                    {
                      id: "maps",
                      label: "マップ別件数",
                      value:
                        model.currentBasis.source.maps
                          .map((map) => `${map.displayName} ${map.matchCount}試合`)
                          .join("、") || "未取得",
                    },
                  ]}
                />
              </Disclosure>
            ) : null}
            {model.previousBasis && !candidateActive ? (
              <div className="grid justify-items-start gap-1">
                <CommandButton
                  action={model.actions.restore}
                  label="直前の基準で比較する"
                  pendingLabel="比較を準備中"
                />
                {model.actions.restore.disabledReason &&
                !operationInProgress &&
                !model.communicationUnknown ? (
                  <p className={cn(contentText.supporting, readableTextWidthClass)}>
                    {model.actions.restore.disabledReason}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
          {model.review.reasons.length === 0 && model.review.explanation ? (
            <p className={cn(contentText.supporting, readableTextWidthClass)}>
              {model.review.explanation}
            </p>
          ) : null}
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
      {model.review.reasons.length > 0 ? (
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
      <section aria-labelledby="radar-candidate-heading" className="grid min-w-0 gap-4">
        <div className="grid gap-1">
          <h3 className={contentText.heading} id="radar-candidate-heading">
            {candidateActive ? "候補の比較" : "新しい基準"}
          </h3>
          {candidateActive && model.preview?.candidateBasis.createdAt ? (
            <p className={cn(contentText.supporting, "tabular-nums")}>
              {formatDateTimeLong(model.preview.candidateBasis.createdAt)} 作成
            </p>
          ) : null}
        </div>
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
            {model.actions.retry.disabledReason ? (
              <p>{model.actions.retry.disabledReason}</p>
            ) : null}
          </Notice>
        ) : null}
        {candidateActive ? (
          <>
            {candidate.status === "invalid" ? (
              <Notice title="この候補は適用できません" tone="warning">
                {candidate.failureMessage ??
                  "候補を作った記録が変更されました。候補を取り下げ、最新の記録から作り直してください。"}
              </Notice>
            ) : null}
            {candidate.status === "unavailable" ? (
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
            {candidate.status === "ready" &&
            (model.previewState === "stale" ||
              model.previewState === "none" ||
              model.previewState === "failed") ? (
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
                    label="最新の記録で比較を計算する"
                    pendingLabel="比較計算を受付中"
                    primary
                  />
                }
              >
                {null}
              </Notice>
            ) : null}
            {model.preview ? (
              <PlayerRadarPreview
                preview={model.preview}
                filter={model.previewFilter}
                updating={model.previewUpdating}
                onSeasonChange={model.actions.selectSeason}
                onMapChange={model.actions.selectMap}
                onResetFilter={model.actions.resetPreviewFilter}
              />
            ) : null}
            <div className={actionRowClass}>
              {applyTarget ? (
                <AlertDialog
                  finalFocus={() =>
                    applyTriggerRef.current?.isConnected && !applyTriggerRef.current.disabled
                      ? applyTriggerRef.current
                      : headingRef.current
                  }
                  open={confirmation !== null}
                  onOpenChange={(open) => setConfirmation(open ? applyTarget : null)}
                  confirmDisabled={
                    Boolean(model.applyDisabledReason) || Boolean(confirmationChanged)
                  }
                  confirmLabel="作品全体に適用する"
                  pendingLabel="適用を受付中"
                  description={`${confirmation?.gameTitleName ?? model.gameTitleName}の全シーズン・全マップに適用します。過去の成績もこの基準で再採点します。`}
                  formatError={radarCommandErrorMessage}
                  pending={model.applyPending}
                  title="この基準を作品全体に適用しますか？"
                  tone="primary"
                  trigger={
                    <Button
                      disabled={Boolean(model.applyDisabledReason)}
                      ref={applyTriggerRef}
                      variant={model.applyDisabledReason ? "secondary" : "primary"}
                    >
                      適用を確認する
                    </Button>
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
                    }
                  }}
                >
                  <FactList
                    ariaLabel="適用する採点基準"
                    items={[
                      {
                        id: "created",
                        label: "基準作成日時",
                        value: formatDateTimeLong(
                          confirmation?.basis.createdAt ?? undefined,
                          "未取得",
                        ),
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
                  {confirmationChanged ? (
                    <p className={cn(contentText.body, readableTextWidthClass)}>
                      比較または現行基準が変わりました。いったん閉じ、最新の比較を確認してください。
                    </p>
                  ) : null}
                </AlertDialog>
              ) : null}
              <AlertDialog
                finalFocus={() =>
                  withdrawTriggerRef.current?.isConnected && !withdrawTriggerRef.current.disabled
                    ? withdrawTriggerRef.current
                    : headingRef.current
                }
                open={withdrawOpen}
                onOpenChange={setWithdrawOpen}
                confirmLabel={applicationInProgress ? "適用を取り下げる" : "候補を取り下げる"}
                pendingLabel="取り下げを受付中"
                description={
                  applicationInProgress
                    ? "公開前であれば、適用を取り消します。"
                    : "この候補の比較と適用を終了します。"
                }
                formatError={radarCommandErrorMessage}
                pending={model.actions.withdraw.pending}
                confirmDisabled={Boolean(model.actions.withdraw.disabledReason)}
                title={
                  applicationInProgress
                    ? "この基準の適用を取り下げますか？"
                    : "この候補を取り下げますか？"
                }
                trigger={
                  <Button
                    disabled={Boolean(model.actions.withdraw.disabledReason)}
                    ref={withdrawTriggerRef}
                    variant="quiet"
                  >
                    {applicationInProgress ? "適用を取り下げる" : "候補を取り下げる"}
                  </Button>
                }
                onConfirm={async () => {
                  await model.actions.withdraw.run();
                }}
              />
            </div>
            {model.applyDisabledReason &&
            applyTarget &&
            !operationInProgress &&
            !model.communicationUnknown ? (
              <p className={cn(contentText.body, readableTextWidthClass)}>
                {model.applyDisabledReason}
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid justify-items-start gap-2">
            <p className={cn(contentText.body, readableTextWidthClass, "tabular-nums")}>
              作品全体の{model.eligibility.matchCount}試合・{model.eligibility.heldEventCount}
              開催から計算します。
            </p>
            <CommandButton
              action={model.actions.generate}
              label="基準候補を計算する"
              pendingLabel="候補計算を受付中"
              primary
            />
            {model.actions.generate.disabledReason &&
            !operationInProgress &&
            !model.communicationUnknown ? (
              <p className={cn(contentText.supporting, readableTextWidthClass)}>
                {model.actions.generate.disabledReason}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}
