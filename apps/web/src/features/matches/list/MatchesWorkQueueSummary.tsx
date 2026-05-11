import type {
  MatchListStatusFilter,
  MatchListSummaryCounts,
} from "@/features/matches/list/matchListTypes";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

type MatchesWorkQueueSummaryProps = {
  counts?: MatchListSummaryCounts;
  currentStatus: MatchListStatusFilter;
  loading?: boolean;
  onSelectStatus: (status: MatchListStatusFilter) => void;
};

const items: Array<{
  countKey: keyof MatchListSummaryCounts;
  label: string;
  status: MatchListStatusFilter;
}> = [
  { countKey: "ocrRunningCount", label: "OCR中", status: "ocr_running" },
  { countKey: "preConfirmCount", label: "確定前", status: "pre_confirm" },
  { countKey: "needsReviewCount", label: "要確認", status: "needs_review" },
];

export function MatchesWorkQueueSummary({
  counts,
  currentStatus,
  loading = false,
  onSelectStatus,
}: MatchesWorkQueueSummaryProps) {
  if (loading) {
    return (
      <section className="grid gap-2 md:grid-cols-3" aria-label="未完了の処理">
        {items.map((item) => (
          <Skeleton key={item.label} className="min-h-16 rounded-[var(--radius-md)]" />
        ))}
      </section>
    );
  }

  const totalIncomplete = counts?.incompleteCount ?? 0;
  if (!counts || totalIncomplete === 0) {
    return null;
  }

  return (
    <section className="grid gap-2 md:grid-cols-3" aria-label="未完了の処理">
      {items.map((item) => {
        const count = counts[item.countKey];
        const selected = currentStatus === item.status;

        return (
          <button
            key={item.label}
            className={cn(
              "flex min-h-16 items-center justify-between rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors duration-150",
              selected
                ? "border-[var(--color-action)]/60 bg-[var(--color-action)]/12"
                : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-subtle)]",
            )}
            aria-pressed={selected}
            onClick={() => onSelectStatus(selected ? "all" : item.status)}
            type="button"
          >
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {item.label}
            </span>
            <span className="text-xl font-semibold text-[var(--color-text-primary)] tabular-nums">
              {count}
            </span>
          </button>
        );
      })}
    </section>
  );
}
