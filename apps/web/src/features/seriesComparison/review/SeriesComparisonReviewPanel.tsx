import { ClipboardList } from "lucide-react";

import { playerNameMap } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { ReviewPlaybookSection } from "@/features/seriesComparison/review/SeriesComparisonReviewPlaybookSection";
import type { AnalysisViewChange } from "@/features/seriesComparison/review/SeriesComparisonReviewTypes";
import type {
  SeriesComparisonResponse,
  SeriesComparisonReviewResponse,
} from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export function ReviewViewContent({
  hasReviewError,
  onRetry,
  onViewChange,
  response,
  review,
  reviewLoading,
}: {
  hasReviewError: boolean;
  onRetry?: (() => void) | undefined;
  onViewChange: AnalysisViewChange;
  response: SeriesComparisonResponse;
  review: SeriesComparisonReviewResponse | undefined;
  reviewLoading: boolean;
}) {
  if (hasReviewError && !review) {
    return (
      <Notice tone="danger" title="次戦の仮説を読み込めません">
        <p>通信状態を確認して、もう一度お試しください。</p>
        {onRetry ? (
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={onRetry}>
              次戦の仮説を再読み込み
            </Button>
          </div>
        ) : null}
      </Notice>
    );
  }
  if (reviewLoading) {
    return <ReviewSkeleton />;
  }
  if (!review) {
    return (
      <EmptyState
        action={
          <Button variant="secondary" onClick={() => onViewChange("overview", { replace: false })}>
            全体戦績を見る
          </Button>
        }
        icon={<ClipboardList className="size-5" />}
        title="次戦の仮説を表示できません"
        description="確定済みの開催が揃うと表示できます。"
      />
    );
  }
  const playerNames = playerNameMap(response.players ?? []);
  return (
    <div className="grid gap-3">
      {hasReviewError ? (
        <Notice tone="warning" title="最新の次戦仮説を取得できません">
          <p>直前に取得した内容を表示しています。</p>
          {onRetry ? (
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                最新情報を再読み込み
              </Button>
            </div>
          ) : null}
        </Notice>
      ) : null}
      <ReviewPlaybookSection
        names={playerNames}
        players={response.players ?? []}
        review={review}
        onViewChange={onViewChange}
      />
    </div>
  );
}

function ReviewSkeleton() {
  return <Skeleton className="min-h-72 rounded-[var(--radius-md)]" />;
}
