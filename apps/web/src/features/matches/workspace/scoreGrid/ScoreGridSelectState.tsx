import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";

export function selectCellTone({
  changed,
  error = false,
  reviewItem,
  reviewed,
}: {
  changed: boolean;
  error?: boolean;
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
}): string {
  if (error) return "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10";
  if (reviewItem && !reviewed) return "border-[var(--color-review)]/75 bg-[var(--color-review)]/14";
  if (changed) return "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18";
  if (reviewItem && reviewed)
    return "border-[var(--color-success)]/55 bg-[var(--color-success)]/12";
  return "";
}

export function ScoreGridSelectStatus({
  cellId,
  changed,
  reviewItem,
  reviewed,
  synced = false,
}: {
  cellId: string;
  changed: boolean;
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
  synced?: boolean;
}) {
  const label =
    reviewItem && !reviewed
      ? "OCR要確認"
      : changed
        ? "手修正"
        : reviewItem && reviewed
          ? "確認済み"
          : synced
            ? "事件簿を同期"
            : null;
  return (
    <div className="min-h-5 pt-1">
      {label ? (
        <p
          className="text-xs leading-4 text-[var(--color-text-secondary)]"
          id={`${cellId}-review-status`}
        >
          {label}
          {reviewItem ? <span className="sr-only">：{reviewItem.message}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
