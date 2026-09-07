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
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { contentText } from "@/shared/ui/typography";

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
      <div aria-label="次戦の準備を読み込み中" className="grid gap-6">
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
  const playbookByPlayer = response.playbookByPlayer;
  return (
    <section
      aria-labelledby={purposeTabId("review")}
      className="grid gap-6"
      id={purposePanelId("review")}
      role="tabpanel"
    >
      <section
        aria-labelledby={
          response.commonPlaybookTopics.length > 0 ? "common-playbook-heading" : undefined
        }
        className="grid gap-2"
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          {response.commonPlaybookTopics.length > 0 ? (
            <h2 className={cn(contentText.heading, "mr-auto")} id="common-playbook-heading">
              複数人共通の行動仮説
            </h2>
          ) : null}
          <SeriesAnalysisReviewHelpDialog />
        </div>
        {response.commonPlaybookTopics.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {response.commonPlaybookTopics.map((topic) => (
              <article className="grid content-start gap-3" key={topic.topicId}>
                <h3 className={contentText.primary}>{topic.heading}</h3>
                <span className={contentText.supporting}>{topic.playerIds.length}人</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      <div className="grid items-start gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
        {playbookByPlayer.map((entry) => (
          <section className="min-w-0" key={entry.player.memberId}>
            <h3 className={contentText.heading}>
              <MemberSequenceLabel memberId={entry.player.memberId}>
                {entry.player.displayName}
              </MemberSequenceLabel>
            </h3>
            {entry.primaryCard ? (
              <div className="mt-2 min-h-0">
                <PlaybookCard card={entry.primaryCard} emphasis onViewChange={onViewChange} />
              </div>
            ) : (
              <div className="mt-2 flex h-full flex-col justify-between gap-3">
                <p className={contentText.body}>今回は無理に作戦を変えず、現在の差を確認します。</p>
                <Button size="sm" variant="secondary" onClick={() => onViewChange("overview")}>
                  今の差を見る
                </Button>
              </div>
            )}
            {entry.secondaryCards.length > 0 ? (
              <div className="mt-6 min-h-11">
                <Disclosure
                  ariaLabel={`${entry.player.displayName}のほかの仮説`}
                  panelPadding="sm"
                  presentation="inset"
                  summary={`ほかの仮説（${entry.secondaryCards.length}件）`}
                >
                  <div className="grid gap-6">
                    {entry.secondaryCards.map((card) => (
                      <PlaybookCard card={card} key={card.cardId} onViewChange={onViewChange} />
                    ))}
                  </div>
                </Disclosure>
              </div>
            ) : null}
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
    <article className={cn("flex h-full min-w-0 flex-col", emphasis ? "gap-6" : "gap-4 py-1")}>
      <div className="grid gap-3">
        <h4 className={emphasis ? contentText.primary : contentText.heading}>
          {card.actionHypothesis}
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              contentText.supporting,
              "rounded-xs border border-[var(--color-border)] px-2 py-0.5",
            )}
          >
            {classificationLabel(card.classification)}
          </span>
          <span className={contentText.supporting}>
            {playbookCategoryLabel(card.category)}・{card.targetCount}戦
          </span>
          <SeriesAnalysisEvidenceStrengthWarning strength={card.evidenceStrength} />
        </div>
      </div>
      <FactList
        ariaLabel="試合中の行動"
        items={[
          { id: "trigger", label: "発動条件", value: card.triggerCondition },
          { id: "action", label: "やること", value: card.recommendedAction },
        ]}
        layout="plain"
      />
      <div className="mt-auto grid">
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
          <div className={cn(contentText.body, "grid gap-4")}>
            <FactList
              ariaLabel="行動の注意と理由"
              items={[
                { id: "avoid", label: "避けること", value: card.avoidAction },
                { id: "reason", label: "データ上の理由", value: card.dataReason },
              ]}
              layout="plain"
            />
            <div>
              <h5 className={contentText.supporting}>判断材料</h5>
              <div className="mt-1 grid gap-2">
                {card.evidence.map((evidence) => {
                  const countLabel = evidenceCountLabel(evidence, card.targetCount);
                  const qualityStatus = evidenceQualityStatus(evidence, card.qualityStatus);
                  return (
                    <p
                      className={cn(contentText.body, "tabular-nums")}
                      key={`${evidence.metricId}:${evidence.label ?? ""}:${evidence.targetCount}:${evidence.value ?? "null"}`}
                    >
                      {evidence.label ?? reviewEvidenceLabel(evidence.metricId)}:{" "}
                      {formatEvidenceValue(evidence.value, evidence.unit)}
                      {countLabel ? (
                        <span className={cn(contentText.supporting, "ml-2")}>{countLabel}</span>
                      ) : null}
                      {qualityStatus ? (
                        <span className="ml-2 empty:hidden">
                          <SeriesAnalysisQualityAdvisory status={qualityStatus} />
                        </span>
                      ) : null}
                      {"method" in evidence && evidence.method ? (
                        <span className={cn(contentText.supporting, "mt-1 block")}>
                          開催単位の再標本化（bootstrap）による95%区間:{" "}
                          {formatDecimal(evidence.confidenceLow)}〜
                          {formatDecimal(evidence.confidenceHigh)}。開催を変えても傾向が残った割合:{" "}
                          {formatPercent(evidence.stability)}。
                        </span>
                      ) : "stability" in evidence && evidence.stability !== null ? (
                        <span className={cn(contentText.supporting, "mt-1 block")}>
                          開催を変えても傾向が残った割合: {formatPercent(evidence.stability)}。
                        </span>
                      ) : null}
                    </p>
                  );
                })}
              </div>
            </div>
            <FactList
              ariaLabel="試合後の検証"
              items={[{ id: "check", label: "試合後の検証", value: card.postMatchCheck }]}
              layout="plain"
            />
            <p className={cn(contentText.supporting, "tabular-nums")}>
              ぶれにくさ: {evidenceStrengthLabel(card.stabilityBand)}
            </p>
          </div>
        </Dialog>
        <Button
          icon={<ChevronRight />}
          size="sm"
          variant="quiet"
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
    (!("status" in evidence) || evidence.status === "hidden" ? cardQualityStatus : evidence.status);
  return status === cardQualityStatus ? null : status;
}

function formatEvidenceValue(value: number | null | string, unit: string | undefined): string {
  if (typeof value === "string") return value;
  if (unit === "rate") return formatPercent(value);
  if (unit === "man_yen") return formatManYen(value);
  return formatDecimal(value);
}
