import { BarChart3, RefreshCw } from "lucide-react";

import { SeriesComparisonContent } from "@/features/seriesComparison/page/SeriesComparisonContent";
import {
  ComparisonSkeleton,
  PageSkeleton,
} from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import { useSeriesComparisonPageController } from "@/features/seriesComparison/page/useSeriesComparisonPageController";
import { Button } from "@/shared/ui/actions/Button";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SelectField } from "@/shared/ui/forms/SelectField";
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
    <PageFrame className="gap-5" width="wide">
      <PageHeader
        actions={
          <Button
            disabled={!aggregate.canRefresh}
            icon={<RefreshCw className="size-4" />}
            pending={aggregate.refreshing || review.refreshing}
            pendingLabel="更新中"
            variant="secondary"
            onClick={page.actions.refresh}
          >
            更新
          </Button>
        }
        description="確定済みの試合から、順位、総資産、物件収益、目的地到着、スリの銀次を比べます。"
        eyebrow="分析"
        title="戦績比較"
      />

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
          <section className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] md:items-end">
            <div className="min-w-0 md:col-span-3">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">表示範囲</h2>
              <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                シーズンとマップを同時に絞れます。対象作品の切り替えは過去作品を見るときに使います。
              </p>
            </div>
            <SelectField
              label="シーズン"
              options={filters.seasonOptions}
              value={filters.state.seasonMasterId ?? ""}
              onChange={(event) => filters.updateSeasonMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="マップ"
              options={filters.mapOptions}
              value={filters.state.mapMasterId ?? ""}
              onChange={(event) => filters.updateMapMasterId(event.currentTarget.value)}
            />
            <SelectField
              label="対象作品"
              options={filters.seriesOptions}
              value={filters.state.gameTitleId ?? ""}
              onChange={(event) => filters.updateGameTitle(event.currentTarget.value)}
            />
          </section>

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
                    scopeLabel: filters.scopeLabel,
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
