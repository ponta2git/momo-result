import { motion } from "motion/react";

import type {
  MatchListStatusFilter,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { momoTransition } from "@/shared/ui/motion/variants";

type MatchesWorkQueueSummaryProps = {
  counts?: MatchListSummaryCounts;
  currentStatus: MatchListStatusFilter;
  disabled?: boolean;
  loading?: boolean;
  masked?: boolean;
  onSelectStatus: (status: MatchListStatusFilter) => void;
};

const items: Array<{
  countKey: keyof MatchListSummaryCounts;
  description: string;
  label: string;
  status: MatchListStatusFilter;
}> = [
  {
    countKey: "ocrRunningCount",
    description: "完了待ち",
    label: "OCR中",
    status: "ocr_running",
  },
  {
    countKey: "preConfirmCount",
    description: "確認または手入力",
    label: "確認待ち",
    status: "pre_confirm",
  },
  {
    countKey: "needsReviewCount",
    description: "見直し優先",
    label: "要確認",
    status: "needs_review",
  },
];

export function MatchesWorkQueueSummary({
  counts,
  currentStatus,
  disabled = false,
  loading = false,
  masked = false,
  onSelectStatus,
}: MatchesWorkQueueSummaryProps) {
  if (loading) {
    return (
      <section className="grid min-h-[15.75rem] gap-2 sm:min-h-[6.5rem]" aria-label="未完了の処理">
        <Skeleton className="min-h-6 max-w-36" />
        <div className="grid gap-2 md:grid-cols-3">
          {items.map((item) => (
            <Skeleton key={item.label} className="min-h-16 rounded-[var(--radius-md)]" />
          ))}
        </div>
      </section>
    );
  }

  const totalIncomplete = counts?.incompleteCount ?? 0;

  return (
    <section
      className="grid min-h-[15.75rem] gap-2 sm:min-h-[6.5rem]"
      aria-label={totalIncomplete === 0 ? "未完了の処理はありません" : "未完了の処理"}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">未完了タスク</h2>
        {masked ? (
          <Skeleton className="h-4 w-16" />
        ) : (
          <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
            {totalIncomplete === 0 ? "対応なし" : `${totalIncomplete.toLocaleString()}件`}
          </p>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {items.map((item) => {
          const count = counts?.[item.countKey] ?? 0;
          const selected = currentStatus === item.status;
          const empty = !masked && totalIncomplete === 0;

          return (
            <motion.button
              key={item.label}
              className={cn(
                "momo-enter momo-pressable flex min-h-16 items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-left",
                selected
                  ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12"
                  : empty
                    ? "border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)]",
              )}
              aria-pressed={selected}
              disabled={disabled}
              layout
              transition={momoTransition}
              onClick={() => onSelectStatus(selected ? "all" : item.status)}
              type="button"
              {...(disabled ? {} : { whileTap: { scale: 0.99, y: 1 } })}
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-secondary)]">
                  {empty ? "対応なし" : item.description}
                </span>
              </span>
              {masked ? (
                <Skeleton className="h-7 w-10 shrink-0" />
              ) : (
                <motion.span
                  key={`${item.countKey}-${count}`}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xl font-semibold text-[var(--color-text-primary)] tabular-nums"
                  initial={{ opacity: 0, y: 3 }}
                  transition={momoTransition}
                >
                  {count}
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
