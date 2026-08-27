import { ChevronRight } from "lucide-react";

import {
  classificationLabel,
  evidenceStrengthLabel,
  formatDecimal,
  formatManYen,
  formatPercent,
  playbookCategoryLabel,
  reviewEvidenceLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { SeriesAnalysisReviewHelpDialog } from "@/features/seriesComparison/page/SeriesAnalysisReviewHelpDialog";
import {
  purposePanelId,
  purposeTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import {
  lowEvidenceStrengthWarningLabel,
  SeriesAnalysisEvidenceStrengthWarning,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type {
  SeriesAnalysisPlaybookCard,
  SeriesComparisonReviewV3,
} from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function ReviewView({
  loading,
  onViewChange,
  response,
  showError,
}: {
  loading: boolean;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
  response: SeriesComparisonReviewV3 | undefined;
  showError: boolean;
}) {
  if (loading) {
    return (
      <div aria-label="次戦の準備を読み込み中" className="grid gap-3">
        <Skeleton className="min-h-24" />
        <Skeleton className="min-h-48" />
      </div>
    );
  }
  if (showError || !response) {
    return (
      <Notice tone="danger" title="次戦の準備を読み込めません">
        次戦に向けた振り返りデータを取得できませんでした。
      </Notice>
    );
  }
  const playbookByPlayer = orderFixedMembers(
    response.playbookByPlayer.map((entry) => ({ entry, memberId: entry.player.memberId })),
  ).map(({ entry }) => entry);
  return (
    <section
      aria-labelledby={purposeTabId("review")}
      className="grid gap-6"
      id={purposePanelId("review")}
      role="tabpanel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <dl aria-label="行動仮説の対象" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">対象</dt>
            <dd className="font-semibold">次の4戦</dd>
          </div>
        </dl>
        <SeriesAnalysisReviewHelpDialog />
      </div>
      {response.commonPlaybookTopics.length > 0 ? (
        <section aria-labelledby="common-playbook-heading" className="grid gap-3">
          <h2 className="text-lg font-semibold" id="common-playbook-heading">
            複数人共通の行動仮説
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {response.commonPlaybookTopics.map((topic) => (
              <article key={topic.topicId}>
                <h3 className="text-sm font-semibold">{topic.heading}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                  {topic.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
        {playbookByPlayer.map((entry) => (
          <section
            className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]"
            key={entry.player.memberId}
          >
            <h3 className="text-base font-semibold">
              <MemberSequenceLabel memberId={entry.player.memberId}>
                {entry.player.displayName}
              </MemberSequenceLabel>
            </h3>
            {entry.primaryCard ? (
              <div className="mt-3 min-h-0">
                <PlaybookCard card={entry.primaryCard} emphasis onViewChange={onViewChange} />
              </div>
            ) : (
              <div className="mt-3 flex h-full flex-col justify-between gap-3">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  今回は無理に作戦を変えず、現在の差を確認します。
                </p>
                <Button size="sm" variant="secondary" onClick={() => onViewChange("overview")}>
                  今の差を見る
                </Button>
              </div>
            )}
            <div className="mt-3 min-h-11">
              {entry.secondaryCards.length > 0 ? (
                <Disclosure
                  ariaLabel={`${entry.player.displayName}のほかの仮説`}
                  panelClassName="grid gap-4 p-3"
                  presentation="inset"
                  summary={`ほかの仮説（${entry.secondaryCards.length}件）`}
                >
                  {entry.secondaryCards.map((card) => (
                    <PlaybookCard card={card} key={card.cardId} onViewChange={onViewChange} />
                  ))}
                </Disclosure>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function PlaybookCard({
  card,
  emphasis = false,
  onViewChange,
}: {
  card: SeriesAnalysisPlaybookCard;
  emphasis?: boolean;
  onViewChange: (view: SeriesAnalysisViewId, options?: { replace?: boolean }) => void;
}) {
  return (
    <article className={`flex h-full min-w-0 flex-col gap-3 ${emphasis ? "" : "py-1"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold">
          {classificationLabel(card.classification)}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {playbookCategoryLabel(card.category)}・{card.targetCount}戦
        </span>
        <SeriesAnalysisEvidenceStrengthWarning strength={card.evidenceStrength} />
      </div>
      <div>
        <h4 className="leading-6 font-semibold">{card.actionHypothesis}</h4>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{card.plainReason}</p>
      </div>
      <dl className="grid gap-2 text-sm">
        <PlaybookText label="発動条件" value={card.triggerCondition} />
        <PlaybookText label="やること" value={card.recommendedAction} />
      </dl>
      <div className="mt-auto grid gap-2 pt-1">
        <Dialog
          description={[
            playbookCategoryLabel(card.category),
            lowEvidenceStrengthWarningLabel(card.evidenceStrength),
          ]
            .filter((entry): entry is string => entry !== null)
            .join("・")}
          title="根拠・注意・試合後の確認"
          trigger={
            <Button size="sm" variant="quiet">
              根拠・注意・試合後の確認
            </Button>
          }
        >
          <div className="grid gap-4 text-sm leading-6">
            <PlaybookText label="避けること" value={card.avoidAction} />
            <PlaybookText label="データ上の理由" value={card.dataReason} />
            <div>
              <h5 className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                判断材料
              </h5>
              <div className="mt-1 grid gap-2">
                {card.evidence.map((evidence) => {
                  const countLabel = evidenceCountLabel(evidence, card.targetCount);
                  const qualityStatus = evidenceQualityStatus(evidence, card.qualityStatus);
                  return (
                    <p
                      className="border-l-2 border-[var(--color-border)] px-3 py-2 tabular-nums"
                      key={`${evidence.metricId}:${evidence.label ?? ""}:${evidence.targetCount}:${evidence.value ?? "null"}`}
                    >
                      {evidence.label ?? reviewEvidenceLabel(evidence.metricId)}:{" "}
                      {formatEvidenceValue(evidence.value, evidence.unit)}
                      {countLabel ? (
                        <span className="ml-2 text-[var(--color-text-secondary)]">
                          {countLabel}
                        </span>
                      ) : null}
                      {qualityStatus ? (
                        <SeriesAnalysisQualityAdvisory className="ml-2" status={qualityStatus} />
                      ) : null}
                      {evidence.method ? (
                        <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                          開催単位の再標本化（bootstrap）による95%区間:{" "}
                          {formatDecimal(evidence.confidenceLow)}〜
                          {formatDecimal(evidence.confidenceHigh)}。開催を変えても傾向が残った割合:{" "}
                          {formatPercent(evidence.stability)}。
                        </span>
                      ) : evidence.stability !== undefined && evidence.stability !== null ? (
                        <span className="mt-1 block text-xs text-[var(--color-text-secondary)]">
                          開催を変えても傾向が残った割合: {formatPercent(evidence.stability)}。
                        </span>
                      ) : null}
                    </p>
                  );
                })}
              </div>
            </div>
            <PlaybookText label="試合後の検証" value={card.postMatchCheck} />
            <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
              ぶれにくさ: {evidenceStrengthLabel(card.stabilityBand)}
            </p>
          </div>
        </Dialog>
        <Button
          icon={<ChevronRight className="size-4" />}
          size="sm"
          variant="secondary"
          onClick={() => {
            window.location.hash = card.anchorTarget.sectionId;
            onViewChange(card.anchorTarget.view, { replace: false });
          }}
        >
          {card.anchorTarget.label}
        </Button>
      </div>
    </article>
  );
}

function evidenceCountLabel(
  evidence: SeriesAnalysisPlaybookCard["evidence"][number],
  cardTargetCount: number,
): string | null {
  if (evidence.targetCount !== undefined && evidence.targetCount !== cardTargetCount) {
    return `対象${evidence.targetCount}戦`;
  }
  if (
    evidence.denominator !== undefined &&
    evidence.denominator !== null &&
    evidence.denominator !== cardTargetCount
  ) {
    return `本人基準${evidence.denominator}戦`;
  }
  return null;
}

function evidenceQualityStatus(
  evidence: SeriesAnalysisPlaybookCard["evidence"][number],
  cardQualityStatus: SeriesAnalysisPlaybookCard["qualityStatus"],
): SeriesAnalysisPlaybookCard["qualityStatus"] | null {
  const status =
    evidence.qualityStatus ??
    (evidence.status === "hidden" || evidence.status === undefined
      ? cardQualityStatus
      : evidence.status);
  return status === cardQualityStatus ? null : status;
}

function PlaybookText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-0.5 leading-6">{value}</dd>
    </div>
  );
}

function formatEvidenceValue(value: number | null | string, unit: string | undefined): string {
  if (typeof value === "string") return value;
  if (unit === "rate") return formatPercent(value);
  if (unit === "man_yen") return formatManYen(value);
  return formatDecimal(value);
}
