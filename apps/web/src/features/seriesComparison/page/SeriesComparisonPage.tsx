import { ArrowLeft, BarChart3 } from "lucide-react";

import { SeriesAnalysisContent } from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { SeriesAnalysisScopeBar } from "@/features/seriesComparison/page/SeriesAnalysisScopeBar";
import { SeriesAnalysisStatusFeedback } from "@/features/seriesComparison/page/SeriesAnalysisStatusFeedback";
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
  const { aggregate, filters, options, review, status } = page;

  if (options.loading) return <PageSkeleton />;
  if (page.clientUpgradeRequired) {
    return (
      <PageFrame className="gap-4" width="wide">
        <PageHeader title="戦績比較" />
        <Notice tone="warning" title="画面の更新が必要です">
          <p>戦績分析の表示方法が更新されました。画面を再読み込みしてください。</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={page.actions.reloadClient}>
              画面を再読み込み
            </Button>
          </div>
        </Notice>
      </PageFrame>
    );
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
          title="登録されている作品がありません"
          description="設定管理で作品を登録すると、戦績分析の対象にできます。"
        />
      ) : filters.seriesOptions.length > 0 ? (
        <>
          <SeriesAnalysisScopeBar
            canRefresh={aggregate.canRefresh || Boolean(filters.state.gameTitleId)}
            mapOptions={filters.mapOptions}
            mapValue={filters.state.mapMasterId ?? ""}
            refreshing={aggregate.refreshing || review.refreshing || status.refreshing}
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
          <SeriesAnalysisStatusFeedback
            confirmedMatchCount={filters.confirmedMatchCount}
            hasError={status.hasError}
            loading={status.loading}
            status={status.data}
            onRefresh={page.actions.refresh}
          />
          {status.loading && !status.data ? <ComparisonSkeleton /> : null}
          {!status.loading &&
          status.data?.currentArtifact &&
          aggregate.hasError &&
          !aggregate.data ? (
            <Notice tone="danger" title="戦績データを読み込めません">
              <p>
                保存済み成果物を取得できませんでした。通信状態を確認して再読み込みしてください。
              </p>
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={page.actions.refresh}>
                  戦績データを再読み込み
                </Button>
              </div>
            </Notice>
          ) : status.data?.currentArtifact && aggregate.data ? (
            <div className="grid gap-3">
              {aggregate.hasError ? (
                <Notice tone="warning" title="最新の戦績データを取得できません">
                  直前に取得した成果物を表示しています。
                </Notice>
              ) : null}
              <StaleShield
                active={aggregate.loading || aggregate.shielded || review.shielded}
                busyLabel="比較条件を更新中"
                contentClassName="grid gap-4"
                fallback={<ComparisonSkeleton />}
                preserveContent
              >
                {aggregate.data.scope.matchCount === 0 ? (
                  <EmptyState
                    action={
                      filters.state.mapMasterId || filters.state.seasonMasterId ? (
                        <Button variant="secondary" onClick={page.actions.clearScope}>
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
                ) : (
                  <SeriesAnalysisContent
                    activeView={filters.activeView}
                    focusMatchId={filters.state.focusMatchId}
                    response={aggregate.data}
                    review={review.data}
                    reviewError={review.hasError}
                    reviewLoading={review.loading}
                    onArtifactExpired={page.actions.refresh}
                    onClearFocusedMatch={page.actions.clearFocusedMatch}
                    onFocusMatch={page.actions.focusMatch}
                    onViewChange={filters.updateView}
                  />
                )}
              </StaleShield>
            </div>
          ) : null}
        </>
      ) : null}
    </PageFrame>
  );
}
