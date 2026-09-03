import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";

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
  if (totalCount === 0 || remainingCount === 0) {
    return null;
  }

  return (
    <div
      aria-label="OCRの確認項目"
      className="grid gap-3 rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
    >
      <div className="min-w-0" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-xs border border-[var(--color-review)]/70 bg-[var(--color-review)]/14 px-2 py-0.5 text-xs font-semibold text-[var(--color-text-primary)] tabular-nums">
            未確認{remainingCount}件／全{totalCount}件
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
          <p
            className={cn(
              "mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]",
              readableTextWidthClass,
            )}
          >
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
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="grid">
          <Button
            aria-label="前の要確認セルへ"
            icon={<ChevronLeft aria-hidden="true" />}
            size="sm"
            variant="secondary"
            onClick={onPrevious}
          >
            前へ
          </Button>
        </div>
        <div className="grid">
          <Button
            aria-label="次の要確認セルへ"
            icon={<ChevronRight aria-hidden="true" />}
            size="sm"
            variant="secondary"
            onClick={onNext}
          >
            次へ
          </Button>
        </div>
        <div className="col-span-2 grid sm:col-span-1">
          <Button
            disabled={!activeItem || activeReviewed}
            icon={<Check aria-hidden="true" />}
            size="sm"
            onClick={onAcknowledge}
          >
            この値で確認済み
          </Button>
        </div>
      </div>
    </div>
  );
}
