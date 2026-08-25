import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import type { ControlTone } from "@/shared/ui/forms/Control";

export function selectCellTone({
  changed,
  reviewItem,
  reviewed,
}: {
  changed: boolean;
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
}): ControlTone {
  if (reviewItem && !reviewed) return "review";
  if (changed) return "warning";
  if (reviewItem && reviewed) return "success";
  return "default";
}

export function ScoreGridSelectStatus({
  cellId,
  changed,
  error = false,
  reviewItem,
  reviewed,
  synced = false,
}: {
  cellId: string;
  changed: boolean;
  error?: boolean;
  reviewItem: ReviewItem | undefined;
  reviewed: boolean;
  synced?: boolean;
}) {
  const label = error
    ? "入力を確認してください"
    : reviewItem && !reviewed
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
