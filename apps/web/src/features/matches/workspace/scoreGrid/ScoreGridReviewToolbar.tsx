import { Check, ChevronLeft, ChevronRight } from "lucide-react";

import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import { sourceImageKindLabels } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

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
      className="min-w-0 rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] p-3"
    >
      <ContentWithActions
        actions={
          <div className={inlineActionGroupClass}>
            <Button
              aria-label="前の要確認セルへ"
              icon={<ChevronLeft aria-hidden="true" />}
              size="sm"
              variant="secondary"
              onClick={onPrevious}
            >
              前へ
            </Button>
            <Button
              aria-label="次の要確認セルへ"
              icon={<ChevronRight aria-hidden="true" />}
              size="sm"
              variant="secondary"
              onClick={onNext}
            >
              次へ
            </Button>
            <Button
              disabled={!activeItem || activeReviewed}
              icon={<Check aria-hidden="true" />}
              size="sm"
              onClick={onAcknowledge}
            >
              この値で確認済み
            </Button>
          </div>
        }
      >
        <div className="min-w-0" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-plain rounded-xs border border-[var(--color-review)]/70 bg-[var(--color-review)]/14 px-2 py-0.5 text-xs text-[var(--color-text-primary)] tabular-nums">
              未確認{remainingCount}件／全{totalCount}件
            </span>
            {activeItem ? (
              <span className={contentText.compactPrimary}>{activeItem.label}</span>
            ) : null}
            {activeReviewed ? (
              <span className="font-plain text-xs text-[var(--color-success)]">確認済み</span>
            ) : null}
          </div>
          {activeItem ? (
            <div className="mt-1 grid gap-1">
              <p className={cn(contentText.body, "text-pretty", readableTextWidthClass)}>
                {activeItem.message}
              </p>
              <p className={contentText.supporting}>
                {sourceImageKindLabels[activeItem.sourceKind]}
                {activeItem.confidence === null
                  ? ""
                  : `・確度 ${Math.round(activeItem.confidence * 100)}%`}
              </p>
            </div>
          ) : (
            <p className={cn(contentText.body, "mt-1")}>すべての強調項目を確認しました。</p>
          )}
        </div>
      </ContentWithActions>
    </div>
  );
}
