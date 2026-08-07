import { ArrowLeft, BarChart3 } from "lucide-react";

import { SeriesComparisonContent } from "@/features/seriesComparison/page/SeriesComparisonContent";
import { SeriesComparisonScopeBar } from "@/features/seriesComparison/page/SeriesComparisonScopeBar";
import {
  ComparisonSkeleton,
  PageSkeleton,
} from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/page/useSeriesComparisonPageController";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
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
      <PageHeader
        actions={
          page.returnTo ? (
            <LinkButton
              icon={<ArrowLeft aria-hidden="true" className="size-4" />}
              size="sm"
              to={page.returnTo}
              variant="quiet"
            >
              前の画面へ戻る
            </LinkButton>
          ) : null
        }
        title="戦績比較"
      />

      {options.hasError ? (
        <Notice
          tone={options.hasVisibleData ? "warning" : "danger"}
          title={
            options.hasVisibleData ? "最新の比較対象を取得できません" : "対象作品を読み込めません"
          }
        >
          <p>
            {options.hasVisibleData
              ? "直前に取得した対象を表示しています。"
              : "通信状態を確認して、もう一度お試しください。"}
          </p>
          <div className="mt-3">
            <Button
              pending={options.refreshing}
              pendingLabel="再読み込み中"
              size="sm"
              variant="secondary"
              onClick={page.actions.refresh}
            >
              比較対象を再読み込み
            </Button>
          </div>
        </Notice>
      ) : null}

      {filters.seriesOptions.length === 0 && !options.hasError ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title="比較できる戦績がありません"
          description="確定済みの試合が揃うと比較できます。"
          action={<LinkButton to="/matches">試合一覧を開く</LinkButton>}
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

          {aggregate.hasError && !aggregate.data ? (
            <Notice tone="danger" title="戦績データを読み込めません">
              <p>通信状態を確認して、もう一度お試しください。</p>
              <div className="mt-3">
                <Button
                  pending={aggregate.refreshing}
                  pendingLabel="再読み込み中"
                  size="sm"
                  variant="secondary"
                  onClick={page.actions.refresh}
                >
                  戦績データを再読み込み
                </Button>
              </div>
            </Notice>
          ) : (
            <div className="grid gap-3">
              {aggregate.hasError && aggregate.data ? (
                <Notice tone="warning" title="最新の戦績データを取得できません">
                  <p>直前に取得した内容を表示しています。</p>
                  <div className="mt-3">
                    <Button size="sm" variant="secondary" onClick={page.actions.refresh}>
                      最新情報を再読み込み
                    </Button>
                  </div>
                </Notice>
              ) : null}
              <StaleShield
                active={aggregate.loading || aggregate.shielded || review.shielded}
                busyLabel="比較条件を更新中"
                contentClassName="grid gap-4"
                fallback={<ComparisonSkeleton />}
                preserveContent={Boolean(aggregate.data) && !aggregate.loading}
              >
                {aggregate.data && aggregate.data.matchCount === 0 ? (
                  <EmptyState
                    action={
                      filters.state.mapMasterId || filters.state.seasonMasterId ? (
                        <Button variant="secondary" onClick={filters.clearScope}>
                          総合に戻す
                        </Button>
                      ) : (
                        <LinkButton to="/matches">試合一覧を開く</LinkButton>
                      )
                    }
                    icon={<BarChart3 className="size-5" />}
                    title="この範囲に確定済みの試合がありません"
                    description="総合、別シーズン、別マップを選ぶと表示できる場合があります。"
                  />
                ) : aggregate.data ? (
                  <SeriesComparisonContent
                    model={{
                      activeView: filters.activeView,
                      focusMatchId: filters.state.focusMatchId,
                      hasReviewError: review.hasError,
                      onClearFocusedMatch: filters.clearFocusedMatch,
                      onRetryReview: review.retry,
                      onViewChange: filters.updateView,
                      response: aggregate.data,
                      review: review.data,
                      reviewLoading: review.loading && !review.data,
                    }}
                  />
                ) : null}
              </StaleShield>
            </div>
          )}
        </>
      ) : null}
    </PageFrame>
  );
}
