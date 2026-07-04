import { ArrowRight, ChevronDown } from "lucide-react";

import {
  defaultSeriesComparisonView,
  isSeriesComparisonViewId,
} from "@/features/seriesComparison/model/seriesComparisonViewModel";
import {
  evidenceStats,
  playbookCategoryLabel,
  playbookEvidenceStatusLabel,
  playbookEvidenceStrengthLabel,
  reviewPlaybookLane,
} from "@/features/seriesComparison/review/seriesComparisonReviewPresentation";
import type {
  AnalysisViewChange,
  ReviewAnchorTarget,
  ReviewPlaybookCard,
  ReviewPlaybookEvidence,
} from "@/features/seriesComparison/review/SeriesComparisonReviewTypes";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import {
  CollapsiblePanel,
  CollapsibleRoot,
  CollapsibleTrigger,
} from "@/shared/ui/data/Collapsible";

export function ReviewPlaybookCardView({
  card,
  onViewChange,
}: {
  card: ReviewPlaybookCard;
  onViewChange: AnalysisViewChange;
}) {
  const lane = reviewPlaybookLane(card);
  return (
    <article className="grid min-w-0 content-start gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm">
      <header className="grid min-w-0 gap-2 border-b border-[var(--color-border)] pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "shrink-0 rounded-[var(--radius-xs)] border px-1.5 py-0.5 text-[11px] font-semibold",
              lane.className,
            )}
          >
            {lane.label}
          </span>
          <div className="min-w-0">
            <h4 className="text-sm leading-6 font-semibold text-balance text-[var(--color-text-primary)]">
              {card.actionHypothesis}
            </h4>
            <p className="mt-1 text-[11px] leading-4 text-[var(--color-text-secondary)]">
              {playbookCategoryLabel(card.category)} / 根拠{" "}
              {playbookEvidenceStrengthLabel(card.evidenceStrength)}
            </p>
          </div>
        </div>
      </header>
      <div className="grid min-w-0 content-start gap-2.5">
        <ReviewPlaybookText label="発動条件" text={card.triggerCondition} />
        <ReviewPlaybookText label="やること" text={card.recommendedAction} tone="action" />
        <ReviewPlaybookText label="理由" text={card.plainReason} />
        <ReviewPlaybookSupportDisclosure card={card} />
        <ReviewPlaybookEvidenceDisclosure card={card} />
      </div>
      <div className="flex min-w-0 justify-end">
        <Button
          className="justify-center"
          icon={<ArrowRight className="size-4" />}
          aria-label={`詳細: ${card.anchorTarget.label}へ`}
          size="sm"
          variant="secondary"
          onClick={() => jumpToReviewAnchor(card.anchorTarget, onViewChange)}
        >
          根拠を見る
        </Button>
      </div>
    </article>
  );
}

function ReviewPlaybookSupportDisclosure({ card }: { card: ReviewPlaybookCard }) {
  return (
    <CollapsibleRoot className="min-w-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
      <CollapsibleTrigger
        aria-label="注意・試合後の検証"
        className="group flex min-h-10 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-xs)] px-2.5 py-2 text-left hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
      >
        <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
          注意・試合後の検証
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--color-text-secondary)] group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="border-t border-[var(--color-border)] px-2.5 py-2.5">
        <div className="grid min-w-0 gap-3">
          <ReviewPlaybookText label="避けること" text={card.avoidAction} tone="caution" />
          <ReviewPlaybookText label="試合後の検証" text={card.postMatchCheck} />
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function ReviewPlaybookEvidenceDisclosure({ card }: { card: ReviewPlaybookCard }) {
  const evidence = card.evidence ?? [];
  return (
    <CollapsibleRoot className="min-w-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]">
      <CollapsibleTrigger
        aria-label="詳しい根拠"
        className="group flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[var(--radius-xs)] px-3 py-2 text-left hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)]"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">詳しい根拠</span>
          <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
            指標 {evidence.length}件
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--color-text-secondary)] group-data-[panel-open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="border-t border-[var(--color-border)] px-3 py-3">
        <div className="grid min-w-0 gap-3">
          <ReviewPlaybookText label="データ上の理由" text={card.dataReason} />
          <ReviewPlaybookEvidenceList evidence={evidence} />
        </div>
      </CollapsiblePanel>
    </CollapsibleRoot>
  );
}

function ReviewPlaybookEvidenceList({ evidence }: { evidence: ReviewPlaybookEvidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="min-w-0 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
        <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">主要指標</p>
        <p className="mt-1 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
          主要指標はありません。
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-[var(--color-text-secondary)]">詳しい指標</p>
      <div className="mt-1.5 grid min-w-0 divide-y divide-[var(--color-border)] rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        {evidence.map((item) => (
          <div className="grid min-w-0 gap-1 p-2" key={`${item.metricId}:${item.label}`}>
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
            <ReviewEvidenceStats item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewEvidenceStats({ item }: { item: ReviewPlaybookEvidence }) {
  const stats = evidenceStats(item);
  if (stats.length === 0) {
    return null;
  }
  return (
    <p className="text-[11px] leading-5 text-pretty text-[var(--color-text-secondary)]">
      {stats.join(" / ")}
    </p>
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
