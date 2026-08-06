import { ArrowRight, CircleHelp } from "lucide-react";

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
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Dialog } from "@/shared/ui/feedback/Dialog";

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
      <ReviewCommonPlaybookTopics topics={review.commonPlaybookTopics ?? []} />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">プレーヤー別</p>
        <ReviewPlaybookGuide />
      </div>
      <div className="grid items-stretch gap-x-4 gap-y-6 lg:grid-cols-4 lg:gap-y-3">
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
      className="grid min-w-0 content-start gap-3 border-t-2 border-[var(--color-border)] pt-3 lg:row-span-3 lg:grid-rows-subgrid"
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
        <Disclosure
          className="min-w-0"
          panelClassName="grid gap-3 pt-3"
          summary={`ほかの仮説 ${secondaryCards.length}件`}
          triggerClassName="border-t border-[var(--color-border)] px-1 pt-2 text-xs text-[var(--color-text-secondary)]"
        >
          {secondaryCards.map((card) => (
            <ReviewPlaybookCardView card={card} key={card.id} onViewChange={onViewChange} />
          ))}
        </Disclosure>
      ) : null}
    </section>
  );
}

function ReviewCommonPlaybookTopics({ topics }: { topics: ReviewCommonPlaybookTopic[] }) {
  if (topics.length === 0) {
    return null;
  }
  const topicHeadings = topics.map((topic) => commonTopicHeading(topic.title));
  return (
    <Disclosure
      ariaLabel="卓全体の共通論点"
      className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      panelClassName="border-t border-[var(--color-border)] p-3"
      summary={
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
            卓全体で意識すること
          </span>
          {topicHeadings.map((heading, index) => (
            <span
              className={
                index === 0
                  ? "text-sm leading-5 font-semibold text-pretty text-[var(--color-text-primary)]"
                  : "text-xs leading-5 text-pretty text-[var(--color-text-secondary)]"
              }
              key={`${topics[index]?.id ?? index}:heading`}
            >
              {heading}
            </span>
          ))}
        </span>
      }
    >
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
    </Disclosure>
  );
}

function ReviewPlaybookGuide() {
  const classificationItems = [
    { label: "再現する", text: "うまくいっている条件を、次回も崩さない。" },
    { label: "見直す", text: "崩れやすい条件で、優先順位を変える。" },
    { label: "検証する", text: "まだ断定せず、次回4戦で試す。" },
  ];
  const reliabilityItems = [
    { label: "高", text: "同じ条件の試合が十分あり、次戦の判断軸として扱えます。" },
    { label: "参考", text: "差は見えますが対象試合は少なめです。次回4戦で試す候補です。" },
    { label: "件数少", text: "該当試合がごく少ないため、結論にせず観察を優先します。" },
  ];
  return (
    <Dialog
      description="カードの分類と、根拠をどの程度強く受け取るかを説明します。"
      title="分類と信頼度の読み方"
      trigger={
        <Button icon={<CircleHelp className="size-4" />} size="sm" variant="quiet">
          分類と信頼度の読み方
        </Button>
      }
    >
      <div className="grid min-w-0 gap-5">
        <section aria-labelledby="review-classification-guide">
          <h3
            className="text-sm font-semibold text-[var(--color-text-primary)]"
            id="review-classification-guide"
          >
            分類
          </h3>
          <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-3">
            {classificationItems.map((item) => (
              <div
                className="min-w-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
                key={item.label}
              >
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section
          aria-labelledby="review-reliability-guide"
          className="border-t border-[var(--color-border)] pt-4"
        >
          <h3
            className="text-sm font-semibold text-[var(--color-text-primary)]"
            id="review-reliability-guide"
          >
            信頼度
          </h3>
          <dl className="mt-2 divide-y divide-[var(--color-border)] rounded-[var(--radius-xs)] border border-[var(--color-border)]">
            {reliabilityItems.map((item) => (
              <div
                className="grid min-w-0 gap-1 p-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-3"
                key={item.label}
              >
                <dt className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {item.label}
                </dt>
                <dd className="text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                  {item.text}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <p className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] p-3 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
          発動条件は、試合中に行動仮説を思い出すための目印です。アプリが局面をリアルタイム判定するものではありません。
        </p>
      </div>
    </Dialog>
  );
}

function commonTopicHeading(title: string): string {
  return title.replace(/が共通論点です。?$/u, "");
}
