import { ArrowRight, ClipboardList, Target } from "lucide-react";

import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/seriesComparisonPresentation";
import { playerNameMap } from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  defaultSeriesComparisonView,
  isSeriesComparisonViewId,
} from "@/features/seriesComparison/seriesComparisonViewModel";
import type { SeriesComparisonViewId } from "@/features/seriesComparison/seriesComparisonViewModel";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type AnalysisViewChange = (view: SeriesComparisonViewId, options?: { replace?: boolean }) => void;
type ReviewPlayerPlaybook = NonNullable<SeriesComparisonReviewResponse["playbookByPlayer"]>[number];
type ReviewPlaybookCard = NonNullable<ReviewPlayerPlaybook["cards"]>[number];
type ReviewPlaybookEvidence = NonNullable<ReviewPlaybookCard["evidence"]>[number];
type ReviewCommonPlaybookTopic = NonNullable<
  SeriesComparisonReviewResponse["commonPlaybookTopics"]
>[number];
type ReviewAnchorTarget = ReviewPlaybookCard["anchorTarget"];

export function ReviewViewContent({
  hasReviewError,
  onViewChange,
  response,
  review,
  reviewLoading,
}: {
  hasReviewError: boolean;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
}) {
  if (hasReviewError) {
    return (
      <Notice tone="danger" title="振り返りを読み込めません">
        条件を変えるか、時間をおいて再読み込みしてください。
      </Notice>
    );
  }
  if (reviewLoading) {
    return <ReviewSkeleton />;
  }
  if (!review) {
    return (
      <EmptyState
        icon={<ClipboardList className="size-5" />}
        title="振り返りを表示できません"
        description="確定済みの開催回が揃うと表示できます。"
      />
    );
  }
  const playerNames = playerNameMap(response.players ?? []);
  return (
    <ReviewPlaybookSection
      names={playerNames}
      players={response.players ?? []}
      review={review}
      onViewChange={onViewChange}
    />
  );
}

function ReviewSkeleton() {
  return <Skeleton className="min-h-72 rounded-[var(--radius-md)]" />;
}

function ReviewPlaybookSection({
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
    <div className="grid min-w-0 gap-3 border-b border-[var(--color-border)] pb-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--color-text-primary)]">
            卓全体で出やすい論点
          </p>
          <p className="mt-0.5 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
            複数人に出た候補はここにまとめ、個人カードには4人内で強いものだけを残しています。
          </p>
        </div>
        <span className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
          {topics.length}件
        </span>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {topics.map((topic) => (
          <div
            className="grid min-w-0 gap-2 border-l-2 border-[var(--color-border)] pl-3"
            key={topic.id}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                {playbookCategoryLabel(topic.category)}
              </span>
              <span className="text-xs text-[var(--color-text-secondary)]">
                該当 {topic.affectedPlayerCount}人
              </span>
              <span className="text-xs text-[var(--color-text-secondary)]">
                信頼度 {playbookEvidenceStatusLabel(topic.status)}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm leading-6 font-semibold text-balance text-[var(--color-text-primary)]">
                {topic.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-pretty break-words text-[var(--color-text-secondary)]">
                {topic.summary}
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
    </div>
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
    <div className="grid gap-3 border-y border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-3 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--color-text-primary)]">分析範囲</p>
        <p className="mt-1 text-sm font-semibold text-[var(--color-text-primary)]">
          {scopeName} / {review.baseline.matchCount}戦
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
          この範囲の確定戦績から、次回に持ち帰る仮説だけを残しています。
        </p>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <div className="min-w-0" key={item.label}>
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
      </div>
    </div>
  );
}

function ReviewPlaybookCardView({
  card,
  onViewChange,
}: {
  card: ReviewPlaybookCard;
  onViewChange: AnalysisViewChange;
}) {
  const lane = reviewPlaybookLane(card);
  return (
    <article className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <header className="grid min-w-0 gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-[var(--radius-xs)] border px-1.5 py-0.5 text-[11px] font-semibold",
                lane.className,
              )}
            >
              {lane.label}
            </span>
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              {playbookCategoryLabel(card.category)}
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              対象 {card.targetCount}戦
            </span>
            <span
              className={cn(
                "rounded-[var(--radius-xs)] border px-1.5 py-0.5 text-[10px] font-semibold",
                card.status === "ok"
                  ? "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
              )}
            >
              信頼度 {playbookEvidenceStatusLabel(card.status)}
            </span>
          </div>
          <h4 className="mt-2 text-sm leading-6 font-semibold text-balance text-[var(--color-text-primary)]">
            {card.actionHypothesis}
          </h4>
        </div>
      </header>
      <div className="grid min-w-0 content-start gap-3">
        <ReviewPlaybookText label="発動条件" text={card.triggerCondition} />
        <ReviewPlaybookText label="やること" text={card.recommendedAction} tone="action" />
        <ReviewPlaybookText label="避けること" text={card.avoidAction} tone="caution" />
        <ReviewPlaybookText label="データ上の理由" text={card.dataReason} />
        <ReviewPlaybookEvidenceList evidence={card.evidence ?? []} />
        <ReviewPlaybookText label="試合後の検証" text={card.postMatchCheck} />
      </div>
      <div className="flex min-w-0 justify-end">
        <Button
          className="justify-center"
          icon={<ArrowRight className="size-4" />}
          size="sm"
          variant="secondary"
          onClick={() => jumpToReviewAnchor(card.anchorTarget, onViewChange)}
        >
          詳細: {card.anchorTarget.label}へ
        </Button>
      </div>
    </article>
  );
}

function ReviewPlaybookEvidenceList({ evidence }: { evidence: ReviewPlaybookEvidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">主要指標</p>
        <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
          主要指標はありません。
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">主要指標</p>
      <div className="mt-1 grid min-w-0 border-y border-[var(--color-border)]">
        {evidence.map((item) => (
          <div
            className="grid min-w-0 gap-1 border-t border-[var(--color-border)] py-1.5 first:border-t-0"
            key={`${item.metricId}:${item.label}`}
          >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
              <p className="min-w-0 text-xs leading-5 text-[var(--color-text-secondary)]">
                {item.label}
              </p>
              <span className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                {playbookEvidenceStatusLabel(item.status)}
              </span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <p className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                {item.value}
              </p>
              <p className="text-right text-[11px] text-[var(--color-text-secondary)]">
                {item.targetCount > 0 ? `対象 ${item.targetCount}戦` : "対象なし"}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewPlaybookText({
  label,
  text,
  tone = "neutral",
}: {
  label: string;
  text: string;
  tone?: "action" | "caution" | "neutral";
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        tone === "action"
          ? "border-l-2 border-[var(--color-success)] pl-2.5"
          : tone === "caution"
            ? "border-l-2 border-[var(--color-review)] pl-2.5"
            : "",
      )}
    >
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-0.5 text-sm leading-6 text-pretty break-words text-[var(--color-text-primary)]">
        {text}
      </p>
    </div>
  );
}

function reviewPlaybookLane(card: ReviewPlaybookCard): {
  className: string;
  label: string;
  order: number;
} {
  if (card.classification === "reproduce") {
    return {
      className:
        "border-[var(--color-success)]/45 bg-[var(--color-success)]/10 text-[var(--color-success)]",
      label: "再現する",
      order: 1,
    };
  }
  if (card.classification === "revise") {
    return {
      className:
        "border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
      label: "見直す",
      order: 2,
    };
  }
  return {
    className:
      "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]",
    label: "検証する",
    order: 3,
  };
}

function reviewPlaybookCardOrder(a: ReviewPlaybookCard, b: ReviewPlaybookCard): number {
  const laneOrder = reviewPlaybookLane(a).order - reviewPlaybookLane(b).order;
  if (laneOrder !== 0) {
    return laneOrder;
  }
  return b.actionAdviceScore - a.actionAdviceScore;
}

function jumpToReviewAnchor(target: ReviewAnchorTarget, onViewChange: AnalysisViewChange): void {
  const nextView = isSeriesComparisonViewId(target.view)
    ? target.view
    : defaultSeriesComparisonView;
  onViewChange(nextView, { replace: false });
  globalThis.setTimeout(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.getElementById(target.sectionId)?.scrollIntoView?.({
      block: "start",
      behavior: "smooth",
    });
  }, 0);
}

function playbookCategoryLabel(category: string): string {
  switch (category) {
    case "revenue":
      return "物件収益";
    case "destination":
      return "目的地";
    case "assets":
      return "資産";
    case "playOrder":
      return "番手";
    case "recovery":
      return "下位後の戻し方";
    case "ginji":
      return "スリの銀次";
    default:
      return "その他";
  }
}

function playbookEvidenceStatusLabel(status: string): string {
  switch (status) {
    case "ok":
      return "高";
    case "reference":
      return "参考";
    case "insufficient":
      return "件数少";
    case "no_target":
      return "対象なし";
    default:
      return "根拠";
  }
}
