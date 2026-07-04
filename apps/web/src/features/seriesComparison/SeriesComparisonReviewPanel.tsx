import { ClipboardList } from "lucide-react";

import { playerNameMap } from "@/features/seriesComparison/seriesComparisonPresentation";
import { ReviewPlaybookSection } from "@/features/seriesComparison/SeriesComparisonReviewPlaybookSection";
import type { AnalysisViewChange } from "@/features/seriesComparison/SeriesComparisonReviewTypes";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

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
