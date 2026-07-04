import { ChevronDown, Target } from "lucide-react";

import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/seriesComparisonPresentation";
import { ReviewPlaybookCardView } from "@/features/seriesComparison/SeriesComparisonReviewPlaybookCard";
import {
  playbookCategoryLabel,
  playbookEvidenceStatusLabel,
  reviewPlaybookCardOrder,
} from "@/features/seriesComparison/seriesComparisonReviewPresentation";
import type {
  AnalysisViewChange,
  ReviewCommonPlaybookTopic,
} from "@/features/seriesComparison/SeriesComparisonReviewTypes";
import type { SeriesComparisonReviewResponse } from "@/shared/api/seriesComparison";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/shared/ui/data/Collapsible";

export function ReviewPlaybookSection({
  names,
  onViewChange,
  players,
  review,
}: {
  names: Map<string, string>;
  onViewChange: AnalysisViewChange;
  players: Player[];
  review: SeriesComparisonReviewResponse;
}) {
  const playbooks = review.playbookByPlayer ?? [];
  const playbookByMember = new Map(playbooks.map((entry) => [entry.memberId, entry]));
  const orderedPlayers =
    players.length > 0
      ? players
      : playbooks.map((entry, index) => ({
          displayName: entry.memberDisplayName ?? names.get(entry.memberId) ?? `社長${index + 1}`,
          memberId: entry.memberId,
        }));
  return (
    <MetricSection
      description="次回4戦で試す行動仮説を、発動条件と試合後の確認方法までまとめます。"
      icon={<Target className="size-5" />}
      id="review-playbook"
      title="行動プレイブック"
    >
      <ReviewPlaybookGuide review={review} />
      <ReviewCommonPlaybookTopics topics={review.commonPlaybookTopics ?? []} />
      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
        {orderedPlayers.map((player, index) => (
          <section
            className="grid min-w-0 content-start gap-3 border-t-2 border-[var(--color-border)] pt-3"
            key={player.memberId}
            style={{ borderTopColor: playerColor(index) }}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold break-words text-[var(--color-text-primary)]">
                  {player.displayName}
                </h3>
              </div>
              <span className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                {playbookByMember.get(player.memberId)?.cards?.length ?? 0}件
              </span>
            </div>
            <div className="grid min-w-0 items-stretch gap-3">
              {(playbookByMember.get(player.memberId)?.cards ?? []).length > 0 ? (
                [...(playbookByMember.get(player.memberId)?.cards ?? [])]
                  .toSorted(reviewPlaybookCardOrder)
                  .map((card) => (
                    <ReviewPlaybookCardView card={card} key={card.id} onViewChange={onViewChange} />
                  ))
              ) : (
                <p className="rounded-[var(--radius-xs)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-3 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
                  この条件で次回に持ち帰る仮説はありません。弱い差分は採用していません。
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </MetricSection>
  );
}

function ReviewCommonPlaybookTopics({ topics }: { topics: ReviewCommonPlaybookTopic[] }) {
  if (topics.length === 0) {
    return null;
  }
  return (
    <CollapsibleRoot className="min-w-0 border-b border-[var(--color-border)] pb-3">
      <CollapsibleTrigger
        aria-label="卓全体の共通論点"
        className="group flex min-h-10 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-xs)] px-2 py-1.5 text-left hover:bg-[var(--color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-[var(--color-text-primary)]">
            卓全体の共通論点
          </span>
          <span className="block text-xs leading-5 text-[var(--color-text-secondary)]">
            重複候補 {topics.length}件をまとめて確認
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--color-text-secondary)] group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="pt-2">
        <div className="grid min-w-0 gap-2 lg:grid-cols-2">
          {topics.map((topic) => (
            <div
              className="grid min-w-0 gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2.5"
              key={topic.id}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
                  {playbookCategoryLabel(topic.category)}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  該当 {topic.affectedPlayerCount}人
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  信頼度 {playbookEvidenceStatusLabel(topic.status)}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm leading-6 font-semibold text-balance text-[var(--color-text-primary)]">
                  {topic.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-pretty break-words text-[var(--color-text-primary)]">
                  {topic.actionHint}
                </p>
                {(topic.memberDisplayNames ?? []).length > 0 ? (
                  <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                    対象: {(topic.memberDisplayNames ?? []).join("、")}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function ReviewPlaybookGuide({ review }: { review: SeriesComparisonReviewResponse }) {
  const scopeName =
    review.baseline.supplementalScopeName ?? review.baseline.scope.scopeName ?? "選択範囲";
  const items = [
    { label: "再現する", text: "うまくいっている条件を、次回も崩さない。" },
    { label: "見直す", text: "崩れやすい条件で、優先順位を変える。" },
    { label: "検証する", text: "まだ断定せず、次回4戦で試す。" },
  ];
  return (
    <CollapsibleRoot className="grid gap-2 border-y border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">分析範囲</p>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {scopeName} / {review.baseline.matchCount}戦
          </p>
        </div>
        <CollapsibleTrigger
          aria-label="分類と信頼度の読み方"
          className="group inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
        >
          読み方
          <ChevronDown aria-hidden="true" className="size-3.5 group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel className="grid min-w-0 gap-2 pt-1 sm:grid-cols-3">
        {items.map((item) => (
          <div
            className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] p-2"
            key={item.label}
          >
            <p className="text-xs font-semibold text-[var(--color-text-primary)]">{item.label}</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--color-text-secondary)]">
              {item.text}
            </p>
          </div>
        ))}
        <p className="text-xs leading-5 text-[var(--color-text-secondary)] sm:col-span-3">
          発動条件は試合中に自分で気づくための目印です。リアルタイム判定ではありません。
          信頼度は、高=十分な件数、参考=少数データ、件数少=扱い注意です。
        </p>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}
