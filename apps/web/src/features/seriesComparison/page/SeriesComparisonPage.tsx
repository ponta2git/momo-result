import { BarChart3 } from "lucide-react";

import { SeriesComparisonContent } from "@/features/seriesComparison/page/SeriesComparisonContent";
import { SeriesComparisonScopeBar } from "@/features/seriesComparison/page/SeriesComparisonScopeBar";
import {
  ComparisonSkeleton,
  PageSkeleton,
} from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/page/useSeriesComparisonPageController";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function SeriesComparisonPage() {
  const page = useSeriesComparisonPageController();
  const { aggregate, filters, options, review } = page;

  if (options.loading) {
    return <PageSkeleton />;
  }

  return (
    <PageFrame className="gap-4" width="wide">
      <PageHeader title="戦績比較" />

      {options.hasError ? (
        <Notice tone="danger" title="対象作品を読み込めません">
          通信状態を確認して、再読み込みしてください。
        </Notice>
      ) : null}

      {filters.seriesOptions.length === 0 && !options.hasError ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できる戦績がありません"
          description="確定済みの試合が揃うと比較できます。"
        />
      ) : filters.seriesOptions.length > 0 ? (
        <>
          <SeriesComparisonScopeBar
            canRefresh={aggregate.canRefresh}
            mapOptions={filters.mapOptions}
            mapValue={filters.state.mapMasterId ?? ""}
            refreshing={aggregate.refreshing || review.refreshing}
            response={aggregate.data}
            scopeLabel={filters.scopeLabel}
            seasonOptions={filters.seasonOptions}
            seasonValue={filters.state.seasonMasterId ?? ""}
            seriesOptions={filters.seriesOptions}
            seriesValue={filters.state.gameTitleId ?? ""}
            onMapChange={filters.updateMapMasterId}
            onRefresh={page.actions.refresh}
            onSeasonChange={filters.updateSeasonMasterId}
            onSeriesChange={filters.updateGameTitle}
          />

          {aggregate.hasError ? (
            <Notice tone="danger" title="戦績データを読み込めません">
              条件を変えるか、時間をおいて再読み込みしてください。
            </Notice>
          ) : (
            <StaleShield
              active={aggregate.loading || aggregate.shielded}
              contentClassName="grid gap-5"
              fallback={<ComparisonSkeleton />}
            >
              {aggregate.data && aggregate.data.matchCount === 0 ? (
                <EmptyState
                  icon={<BarChart3 className="size-5" />}
                  title="この範囲に確定済みの試合がありません"
                  description="総合、別シーズン、別マップを選ぶと表示できる場合があります。"
                />
              ) : aggregate.data ? (
                <SeriesComparisonContent
                  model={{
                    activeView: filters.activeView,
                    hasReviewError: review.hasError,
                    onViewChange: filters.updateView,
                    response: aggregate.data,
                    review: review.shielded ? undefined : review.data,
                    reviewLoading: review.loading || review.shielded,
                  }}
                />
              ) : null}
            </StaleShield>
          )}
        </>
      ) : null}
    </PageFrame>
  );
}
