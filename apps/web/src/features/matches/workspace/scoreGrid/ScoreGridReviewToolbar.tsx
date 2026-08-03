import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { Button } from "@/shared/ui/actions/Button";

export function ScoreGridReviewToolbar({
  activeItem,
  activeReviewed,
  remainingCount,
  totalCount,
  onAcknowledge,
  onNext,
  onPrevious,
}: {
  activeItem: ReviewItem | undefined;
  activeReviewed: boolean;
  remainingCount: number;
  totalCount: number;
  onAcknowledge: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  if (totalCount === 0) {
    return (
      <div className="mt-3 flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-success)]/50 bg-[var(--color-success)]/12 px-3 py-2 text-sm text-[var(--color-text-primary)]">
        <Check aria-hidden="true" className="size-4 text-[var(--color-success)]" />
        OCRで強調された確認項目はありません
      </div>
    );
  }

  return (
    <div
      aria-label="OCR確認レール"
      className="mt-3 grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[var(--radius-xs)] border border-[var(--color-review)]/70 bg-[var(--color-review)]/14 px-2 py-0.5 text-xs font-semibold text-[var(--color-text-primary)] tabular-nums">
            未確認 {remainingCount} / {totalCount}
          </span>
          {activeItem ? (
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {activeItem.label}
            </span>
          ) : null}
          {activeReviewed ? (
            <span className="text-xs font-semibold text-[var(--color-success)]">確認済み</span>
          ) : null}
        </div>
        {activeItem ? (
          <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
            {activeItem.message}
            <span className="ml-1 whitespace-nowrap">
              ・{sourceImageKindLabels[activeItem.sourceKind]}
              {activeItem.confidence === null
                ? ""
                : `・確度 ${Math.round(activeItem.confidence * 100)}%`}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            すべての強調項目を確認しました。
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-label="前の要確認セルへ"
          disabled={remainingCount === 0}
          icon={<ChevronLeft aria-hidden="true" className="size-4" />}
          size="sm"
          variant="secondary"
          onClick={onPrevious}
        >
          前へ
        </Button>
        <Button
          aria-label="次の要確認セルへ"
          disabled={remainingCount === 0}
          icon={<ChevronRight aria-hidden="true" className="size-4" />}
          size="sm"
          variant="secondary"
          onClick={onNext}
        >
          次へ
        </Button>
        <Button
          disabled={!activeItem || activeReviewed}
          icon={<Check aria-hidden="true" className="size-4" />}
          size="sm"
          onClick={onAcknowledge}
        >
          この値で確認済み
        </Button>
      </div>
    </div>
  );
}
