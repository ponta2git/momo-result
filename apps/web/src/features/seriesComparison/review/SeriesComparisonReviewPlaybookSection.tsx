import { ArrowRight, ChevronDown } from "lucide-react";

import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { ReviewPlaybookCardView } from "@/features/seriesComparison/review/SeriesComparisonReviewPlaybookCard";
import {
  playbookCategoryLabel,
  playbookEvidenceStatusLabel,
  reviewPlaybookCardOrder,
} from "@/features/seriesComparison/review/seriesComparisonReviewPresentation";
import type {
  AnalysisViewChange,
  ReviewCommonPlaybookTopic,
  ReviewPlaybookCard,
} from "@/features/seriesComparison/review/SeriesComparisonReviewTypes";
import type { SeriesComparisonReviewResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
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
    <section aria-label="次戦の行動仮説" className="grid min-w-0 gap-5" id="review-playbook">
      <div className="grid gap-x-4 gap-y-6 lg:grid-cols-4">
        {orderedPlayers.map((player, index) => {
          const cards = [...(playbookByMember.get(player.memberId)?.cards ?? [])].toSorted(
            reviewPlaybookCardOrder,
          );
          return (
            <ReviewPlayerPlaybook
              cards={cards}
              color={playerColor(index)}
              key={player.memberId}
              name={player.displayName}
              onViewChange={onViewChange}
            />
          );
        })}
      </div>
      <div className="grid min-w-0 gap-3 border-t border-[var(--color-border)] pt-3">
        <ReviewPlaybookGuide />
        <ReviewCommonPlaybookTopics topics={review.commonPlaybookTopics ?? []} />
      </div>
    </section>
  );
}

function ReviewPlayerPlaybook({
  cards,
  color,
  name,
  onViewChange,
}: {
  cards: ReviewPlaybookCard[];
  color: string;
  name: string;
  onViewChange: AnalysisViewChange;
}) {
  const primaryCard = cards[0];
  const secondaryCards = cards.slice(1);
  return (
    <section
      className="grid min-w-0 content-start gap-3 border-t-2 border-[var(--color-border)] pt-3"
      style={{ borderTopColor: color }}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold break-words text-[var(--color-text-primary)]">
          {name}
        </h2>
        <span className="shrink-0 text-[11px] font-medium text-[var(--color-text-secondary)]">
          {cards.length > 0 ? `${cards.length}件` : "該当なし"}
        </span>
      </div>
      {primaryCard ? (
        <ReviewPlaybookCardView card={primaryCard} onViewChange={onViewChange} />
      ) : (
        <div className="grid gap-3 rounded-[var(--radius-xs)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
          <p className="text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
            この条件では、次回行動として出せる強い差分はありません。弱い差分は採用していません。
          </p>
          <Button
            className="justify-self-start"
            icon={<ArrowRight className="size-4" />}
            size="sm"
            variant="secondary"
            onClick={() => onViewChange("overview", { replace: false })}
          >
            今の差を見る
          </Button>
        </div>
      )}
      {secondaryCards.length > 0 ? (
        <CollapsibleRoot className="min-w-0">
          <CollapsibleTrigger className="group flex min-h-10 w-full items-center justify-between gap-2 border-t border-[var(--color-border)] px-1 pt-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]">
            ほかの仮説 {secondaryCards.length}件
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsiblePanel className="grid gap-3 pt-3">
            {secondaryCards.map((card) => (
              <ReviewPlaybookCardView card={card} key={card.id} onViewChange={onViewChange} />
            ))}
          </CollapsiblePanel>
        </CollapsibleRoot>
      ) : null}
    </section>
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
          className="size-4 shrink-0 text-[var(--color-text-secondary)] transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
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

function ReviewPlaybookGuide() {
  const items = [
    { label: "再現する", text: "うまくいっている条件を、次回も崩さない。" },
    { label: "見直す", text: "崩れやすい条件で、優先順位を変える。" },
    { label: "検証する", text: "まだ断定せず、次回4戦で試す。" },
  ];
  return (
    <CollapsibleRoot className="min-w-0">
      <CollapsibleTrigger
        aria-label="分類と信頼度の読み方"
        className="group flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-xs)] px-2 text-left text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
      >
        分類と信頼度の読み方
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
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
