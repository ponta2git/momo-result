import { ArrowLeft, BarChart3 } from "lucide-react";
import { useEffect } from "react";

import {
  preloadSeriesAnalysisView,
  SeriesAnalysisContent,
} from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { SeriesAnalysisScopeBar } from "@/features/seriesComparison/page/SeriesAnalysisScopeBar";
import { SeriesAnalysisStatusFeedback } from "@/features/seriesComparison/page/SeriesAnalysisStatusFeedback";
import {
  ComparisonSkeleton,
  PageSkeleton,
} from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import { useSeriesComparisonPageModel } from "@/features/seriesComparison/page/useSeriesComparisonPageModel";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

function seriesReturnAction(returnTo: string | undefined) {
  return returnTo ? (
    <LinkButton icon={<ArrowLeft aria-hidden="true" />} size="sm" to={returnTo} variant="quiet">
      前の画面へ戻る
    </LinkButton>
  ) : null;
}

export function SeriesComparisonPage() {
  const page = useSeriesComparisonPageModel();
  const { filters, focus, options, resource, status } = page;

  useEffect(() => {
    if (page.clientUpgradeRequired || filters.seriesOptions.length === 0) return;
    preloadSeriesAnalysisView(filters.activeView);
  }, [filters.activeView, filters.seriesOptions.length, page.clientUpgradeRequired]);

  if (options.loading) return <PageSkeleton showReturnAction={Boolean(page.returnTo)} />;
  if (page.clientUpgradeRequired) {
    return (
      <PageFrame width="wide">
        <PageContentSurface aria-label="戦績比較" className="grid gap-4" role="region">
          {page.returnTo ? (
            <nav aria-label="戦績比較の操作" className={cn(actionRowClass, "justify-end")}>
              {seriesReturnAction(page.returnTo)}
            </nav>
          ) : null}
          <Notice
            action={
              <Button size="sm" onClick={page.actions.reloadClient}>
                画面を再読み込み
              </Button>
            }
            tone="warning"
            title="画面の更新が必要です"
          >
            <p>戦績分析の表示方法が更新されました。画面を再読み込みしてください。</p>
          </Notice>
        </PageContentSurface>
      </PageFrame>
    );
  }

  return (
    <PageFrame width="wide">
      <PageContentSurface
        aria-label="戦績比較"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
        role="region"
      >
        {page.returnTo ? (
          <nav aria-label="戦績比較の操作" className={cn(actionRowClass, "justify-end")}>
            {seriesReturnAction(page.returnTo)}
          </nav>
        ) : null}
        {options.hasError ? (
          <Notice
            action={
              <Button
                pending={options.refreshing}
                pendingLabel="再読み込み中"
                size="sm"
                variant={options.hasVisibleData ? "secondary" : "primary"}
                onClick={page.actions.refresh}
              >
                比較対象を再読み込み
              </Button>
            }
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
          </Notice>
        ) : null}
        {filters.seriesOptions.length === 0 && !options.hasError ? (
          <EmptyState
            icon={<BarChart3 />}
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
              refreshing={resource.refreshing || status.refreshing}
              status={status.data}
              onRefresh={page.actions.refresh}
            />
            {status.loading && !status.data ? <ComparisonSkeleton /> : null}
            {!status.loading &&
            status.data?.currentArtifact &&
            resource.hasError &&
            !resource.data ? (
              <Notice
                action={
                  <Button size="sm" onClick={page.actions.refresh}>
                    戦績データを再読み込み
                  </Button>
                }
                tone="danger"
                title="戦績データを読み込めません"
              >
                <p>分析結果を取得できませんでした。通信状態を確認して再読み込みしてください。</p>
              </Notice>
            ) : status.data?.currentArtifact && resource.data && resource.bundle ? (
              <div className="grid gap-4">
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
                  fallback={<ComparisonSkeleton />}
                  strategy="preserve-inert"
                >
                  <div className="grid gap-4">
                    {resource.data.scope.matchCount === 0 ? (
                      <EmptyState
                        action={
                          filters.state.mapMasterId || filters.state.seasonMasterId ? (
                            <Button variant="secondary" onClick={page.actions.clearScope}>
                              全シーズン・全マップに戻す
                            </Button>
                          ) : (
                            <LinkButton to="/matches">試合一覧を開く</LinkButton>
                          )
                        }
                        icon={<BarChart3 />}
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
                  </div>
                </StaleShield>
              </div>
            ) : null}
          </>
        ) : null}
      </PageContentSurface>
    </PageFrame>
  );
}
