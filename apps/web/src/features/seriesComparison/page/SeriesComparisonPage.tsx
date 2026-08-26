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
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function SeriesComparisonPage() {
  const page = useSeriesComparisonPageController();
  const { filters, focus, options, resource, status } = page;

  if (options.loading) return <PageSkeleton />;
  if (page.clientUpgradeRequired) {
    return (
      <PageFrame width="wide">
        <PageHeader title="戦績比較" />
        <PageContentSurface>
          <Notice tone="warning" title="画面の更新が必要です">
            <p>戦績分析の表示方法が更新されました。画面を再読み込みしてください。</p>
            <div className="mt-3">
              <Button size="sm" onClick={page.actions.reloadClient}>
                画面を再読み込み
              </Button>
            </div>
          </Notice>
        </PageContentSurface>
      </PageFrame>
    );
  }

  return (
    <PageFrame width="wide">
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
      <PageContentSurface className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
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
                variant={options.hasVisibleData ? "secondary" : "primary"}
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
            placement="embedded"
            title="登録されている作品がありません"
            description="設定管理で作品を登録すると、戦績分析の対象にできます。"
          />
        ) : filters.seriesOptions.length > 0 ? (
          <>
            <SeriesAnalysisScopeBar
              canRefresh={resource.canRefresh || Boolean(filters.state.gameTitleId)}
              mapOptions={filters.mapOptions}
              mapValue={filters.state.mapMasterId ?? ""}
              refreshing={resource.refreshing || status.refreshing}
              response={resource.data}
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
            resource.hasError &&
            !resource.data ? (
              <Notice tone="danger" title="戦績データを読み込めません">
                <p>分析結果を取得できませんでした。通信状態を確認して再読み込みしてください。</p>
                <div className="mt-3">
                  <Button size="sm" onClick={page.actions.refresh}>
                    戦績データを再読み込み
                  </Button>
                </div>
              </Notice>
            ) : status.data?.currentArtifact && resource.data && resource.bundle ? (
              <div className="grid gap-3">
                {resource.hasError ? (
                  <Notice tone="warning" title="最新の戦績データを取得できません">
                    直前に取得した分析結果を表示しています。
                  </Notice>
                ) : null}
                {focus.notice ? (
                  <Notice tone="info" title="選択試合の強調表示を解除しました">
                    {focus.notice}
                  </Notice>
                ) : null}
                {focus.hasError ? (
                  <Notice tone="warning" title="選択試合の分析を取得できません">
                    比較結果は表示したままです。更新すると、選択試合の読み込みを再試行します。
                  </Notice>
                ) : null}
                <StaleShield
                  active={resource.loading || resource.shielded || focus.shielded}
                  busyLabel="比較条件を更新中"
                  contentClassName="grid gap-4"
                  fallback={<ComparisonSkeleton />}
                  strategy="preserve-inert"
                >
                  {resource.data.scope.matchCount === 0 ? (
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
                      placement="embedded"
                      title="この範囲に確定済みの試合がありません"
                      description="総合、別シーズン、別マップを選ぶと表示できる場合があります。"
                    />
                  ) : (
                    <SeriesAnalysisContent
                      bundle={resource.bundle}
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
      </PageContentSurface>
    </PageFrame>
  );
}
