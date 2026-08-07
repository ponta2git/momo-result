import { LayoutGroup, motion } from "motion/react";

import type {
  MatchListStatusFilter,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { cn } from "@/shared/ui/cn";
import { momoTransition } from "@/shared/ui/motion/variants";

type MatchesStatusRailProps = {
  counts: MatchListSummaryCounts;
  currentStatus: MatchListStatusFilter;
  disabled?: boolean;
  loading?: boolean;
  masked?: boolean;
  onSelectStatus: (status: MatchListStatusFilter) => void;
};

type StatusRailOption = {
  countKey?: keyof MatchListSummaryCounts;
  label: string;
  status: MatchListStatusFilter;
  toneClass: string;
};

const mainOptions: StatusRailOption[] = [
  {
    label: "すべて",
    status: "all",
    toneClass: "bg-[var(--color-action)]",
  },
  {
    countKey: "incompleteCount",
    label: "未確定",
    status: "incomplete",
    toneClass: "bg-[var(--color-warning)]",
  },
  {
    label: "確定済",
    status: "confirmed",
    toneClass: "bg-[var(--color-success)]",
  },
];

const unfinishedOptions: StatusRailOption[] = [
  {
    countKey: "incompleteCount",
    label: "未確定すべて",
    status: "incomplete",
    toneClass: "bg-[var(--color-warning)]",
  },
  {
    countKey: "ocrRunningCount",
    label: "処理中",
    status: "ocr_running",
    toneClass: "bg-[var(--color-action)]",
  },
  {
    countKey: "preConfirmCount",
    label: "対応待ち",
    status: "pre_confirm",
    toneClass: "bg-[var(--color-warning)]",
  },
  {
    countKey: "needsReviewCount",
    label: "要確認のみ",
    status: "needs_review",
    toneClass: "bg-[var(--color-review)]",
  },
];

const unfinishedStatuses = new Set<MatchListStatusFilter>([
  "incomplete",
  "ocr_running",
  "pre_confirm",
  "needs_review",
]);

function CountBadge({ count, loading }: { count: number | undefined; loading: boolean }) {
  if (loading) {
    return (
      <>
        <span
          aria-hidden="true"
          className="h-5 w-8 animate-pulse rounded-full bg-[var(--color-border)] motion-reduce:animate-none"
        />
        <span className="sr-only">件数を集計中</span>
      </>
    );
  }

  if (count === undefined) {
    return null;
  }

  return (
    <span className="min-w-7 rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-center text-xs font-semibold tabular-nums">
      {count.toLocaleString()}件
    </span>
  );
}

export function MatchesStatusRail({
  counts,
  currentStatus,
  disabled = false,
  loading = false,
  masked = false,
  onSelectStatus,
}: MatchesStatusRailProps) {
  const unfinishedSelected = unfinishedStatuses.has(currentStatus);

  return (
    <section
      aria-busy={loading || masked || undefined}
      aria-label="確定状況"
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-opacity duration-[var(--motion-base)] motion-reduce:transition-none",
        masked ? "opacity-70" : "opacity-100",
      )}
    >
      <LayoutGroup id="matches-main-status">
        <div className="grid grid-cols-3 gap-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)] p-1">
          {mainOptions.map((option) => {
            const selected =
              currentStatus === option.status ||
              (option.status === "incomplete" && unfinishedSelected);
            const count = option.countKey ? counts[option.countKey] : undefined;

            return (
              <button
                key={option.status}
                aria-pressed={selected}
                className={cn(
                  "momo-pressable relative flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-[calc(var(--radius-sm)-0.25rem)] px-2 py-2 text-sm font-semibold text-[var(--color-text-secondary)]",
                  selected
                    ? "cursor-default"
                    : "hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60",
                )}
                disabled={disabled || selected}
                type="button"
                onClick={() => onSelectStatus(option.status)}
              >
                {selected ? (
                  <motion.span
                    className="absolute inset-0 rounded-[calc(var(--radius-sm)-0.25rem)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                    layoutId="active-main-status"
                    transition={momoTransition}
                  />
                ) : null}
                <span className="relative z-[var(--z-base)] min-w-0 truncate">{option.label}</span>
                <span className="relative z-[var(--z-base)] inline-flex shrink-0">
                  <CountBadge count={count} loading={loading && option.countKey !== undefined} />
                </span>
                {selected ? (
                  <motion.span
                    aria-hidden="true"
                    className={cn(
                      "absolute right-2 bottom-0 left-2 z-[var(--z-base)] h-0.5 rounded-full",
                      option.toneClass,
                    )}
                    layoutId="active-main-status-tone"
                    transition={momoTransition}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      <div
        aria-label="未確定の内訳"
        className="flex min-w-0 flex-wrap items-center gap-1 pt-3"
        role="group"
      >
        <LayoutGroup id="matches-unfinished-status">
          {unfinishedOptions.map((option) => {
            const selected = currentStatus === option.status;
            return (
              <button
                key={option.status}
                aria-pressed={selected}
                className={cn(
                  "momo-pressable relative inline-flex min-h-11 items-center gap-1 rounded-full border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]",
                  selected
                    ? "cursor-default"
                    : "hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60",
                )}
                disabled={disabled || selected}
                type="button"
                onClick={() => onSelectStatus(option.status)}
              >
                {selected ? (
                  <motion.span
                    className="absolute inset-0 rounded-full border border-[var(--color-action)]/50 bg-[var(--color-action)]/10"
                    layoutId="active-unfinished-status"
                    transition={momoTransition}
                  />
                ) : null}
                <span className="relative z-[var(--z-base)]">{option.label}</span>
                <span className="relative z-[var(--z-base)] inline-flex">
                  <CountBadge
                    count={counts[option.countKey ?? "incompleteCount"]}
                    loading={loading}
                  />
                </span>
              </button>
            );
          })}
        </LayoutGroup>
      </div>
    </section>
  );
}
