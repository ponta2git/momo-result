import { ChevronRight, CircleHelp } from "lucide-react";

import {
  classificationLabel,
  evidenceStrengthLabel,
  formatDecimal,
  formatManYen,
  formatPercent,
  playbookCategoryLabel,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesAnalysisViewId } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import {
  purposePanelId,
  purposeTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import type {
  SeriesAnalysisPlaybookCard,
  SeriesComparisonReviewV2,
} from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
import { Disclosure } from "@/shared/ui/data/Collapsible";
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
  response: SeriesComparisonReviewV2 | undefined;
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
        保存済みの振り返りデータを取得できませんでした。
      </Notice>
    );
  }
  return (
    <section
      aria-labelledby={purposeTabId("review")}
      className="grid gap-4"
      id={purposePanelId("review")}
      role="tabpanel"
    >
      <div>
        <h2 className="text-lg font-semibold" id="review-heading">
          次戦に備える
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          次の4戦で試す行動仮説です。候補の採否と順序は保存済み成果物のまま表示しています。
        </p>
      </div>
      {response.commonPlaybookTopics.length > 0 ? (
        <Disclosure
          ariaLabel="卓全体で出やすい論点"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
          panelClassName="grid gap-2 border-t border-[var(--color-border)] p-3"
          summary={response.commonPlaybookTopics.map((topic) => topic.heading).join("・")}
        >
          {response.commonPlaybookTopics.map((topic) => (
            <div
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
              key={topic.topicId}
            >
              <p className="text-sm font-semibold">{topic.heading}</p>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{topic.detail}</p>
            </div>
          ))}
        </Disclosure>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">プレーヤー別</h3>
        <Dialog
          description="カードに繰り返さず、ここで共通の読み方を説明します。"
          title="分類と信頼度の読み方"
          trigger={
            <Button icon={<CircleHelp className="size-4" />} size="sm" variant="quiet">
              分類と信頼度の読み方
            </Button>
          }
        >
          <div className="grid gap-4 text-sm leading-6">
            <section>
              <h4 className="font-semibold">分類</h4>
              <dl className="mt-2 grid gap-2">
                <HelpItem
                  label="再現する"
                  value="成績が伸びた条件を、次の4戦でも意識する候補です。"
                />
                <HelpItem
                  label="見直す"
                  value="成績が崩れた条件を避けるため、行動を変える候補です。"
                />
                <HelpItem
                  label="検証する"
                  value="差は見えるものの、まず次の4戦で確かめる候補です。"
                />
              </dl>
            </section>
            <section>
              <h4 className="font-semibold">信頼度</h4>
              <p className="mt-2 text-[var(--color-text-secondary)]">
                対象件数と差のぶれにくさを合わせた読み取り目安です。低い候補は結論ではなく、試す価値のある仮説として扱います。
              </p>
            </section>
            <p className="rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] p-3 text-[var(--color-text-secondary)]">
              発動条件はアプリが試合中に判定するものではありません。次の試合中に自分で思い出すための目安です。
            </p>
          </div>
        </Dialog>
      </div>
      <div className="grid items-stretch gap-3 lg:grid-cols-4">
        {response.playbookByPlayer.map((entry) => (
          <section
            className="grid min-w-0 grid-rows-[auto_1fr_auto] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            key={entry.player.memberId}
          >
            <h3 className="text-base font-semibold">{entry.player.displayName}</h3>
            {entry.primaryCard ? (
              <div className="mt-3 min-h-0">
                <PlaybookCard card={entry.primaryCard} emphasis onViewChange={onViewChange} />
              </div>
            ) : (
              <div className="mt-3 flex h-full flex-col justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] p-3">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  この条件では、次回行動として出せる強い差分はありません。
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
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)]"
                  panelClassName="grid gap-3 border-t border-[var(--color-border)] p-2"
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
    <article
      className={`flex h-full min-w-0 flex-col gap-3 rounded-[var(--radius-sm)] border p-3 ${emphasis ? "border-[var(--color-action)]/55 bg-[var(--color-action)]/6" : "border-[var(--color-border)]"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] font-semibold">
          {classificationLabel(card.classification)}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {playbookCategoryLabel(card.category)}・{card.targetCount}戦・信頼度
          {evidenceStrengthLabel(card.evidenceStrength)}
        </span>
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
          description={`${playbookCategoryLabel(card.category)}・対象${card.targetCount}戦・信頼度${evidenceStrengthLabel(card.evidenceStrength)}`}
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
                {card.evidence.map((evidence) => (
                  <p
                    className="rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] px-3 py-2 tabular-nums"
                    key={`${evidence.metricId}:${evidence.label ?? ""}:${evidence.targetCount}:${evidence.value ?? "null"}`}
                  >
                    {evidence.label ?? evidence.metricId}:{" "}
                    {formatEvidenceValue(evidence.value, evidence.unit)}
                    <span className="ml-2 text-[var(--color-text-secondary)]">
                      対象{evidence.targetCount ?? evidence.denominator ?? card.targetCount}戦・
                      {qualityLabel(
                        evidence.qualityStatus ??
                          (evidence.status === "hidden" || evidence.status === undefined
                            ? card.qualityStatus
                            : evidence.status),
                      )}
                    </span>
                  </p>
                ))}
              </div>
            </div>
            <PlaybookText label="試合後の検証" value={card.postMatchCheck} />
            <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
              4人比較を反映した採用優先度: {formatDecimal(card.actionAdviceScore)}／ぶれにくさ:{" "}
              {evidenceStrengthLabel(card.stabilityBand)}
            </p>
          </div>
        </Dialog>
        <Button
          icon={<ChevronRight className="size-4" />}
          size="sm"
          variant="secondary"
          onClick={() => onViewChange(card.anchorTarget.view, { replace: false })}
        >
          {card.anchorTarget.label}
        </Button>
      </div>
    </article>
  );
}

function HelpItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[6rem_1fr]">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  );
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
