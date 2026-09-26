import { ArrowLeft, BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";

import { matchesSeriesAnalysisScope } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { SeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
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
import { inlineActionGroupClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
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
  const purposeChanging =
    resource.bundle !== undefined &&
    (filters.activeView === "review") !== (resource.bundle.kind === "review");
  const resultsShielded =
    !purposeChanging && (resource.loading || resource.shielded || focus.shielded);
  const updating =
    options.refreshing ||
    status.refreshing ||
    resource.refreshing ||
    resource.loading ||
    resource.shielded ||
    focus.shielded ||
    focus.loading;
  const [requestedRetryOwner, setRequestedRetryOwner] = useState<
    "options" | "status" | "resource"
  >();
  const defaultRetryOwner = options.hasError
    ? "options"
    : status.hasError || (!status.loading && !status.data?.currentArtifact)
      ? "status"
      : resource.hasError && !resource.data
        ? "resource"
        : undefined;

  const requestedRetryStillVisible =
    requestedRetryOwner === "options"
      ? options.hasError
      : requestedRetryOwner === "status"
        ? status.hasError || (!status.loading && !status.data?.currentArtifact)
        : requestedRetryOwner === "resource"
          ? resource.hasError && !resource.data
          : false;
  const retryOwner = requestedRetryStillVisible ? requestedRetryOwner : defaultRetryOwner;
  const retry = (owner: "options" | "status" | "resource") => {
    setRequestedRetryOwner(owner);
    page.actions.refresh();
  };

  useEffect(() => {
    if (filters.seriesOptions.length === 0) return;
    preloadSeriesAnalysisView(filters.activeView);
  }, [filters.activeView, filters.seriesOptions.length]);

  if (options.loading) return <PageSkeleton showReturnAction={Boolean(page.returnTo)} />;

  return (
    <SeriesAnalysisNavigation
      displayIntent={page.displayIntent}
      failed={options.hasError || status.hasError || resource.hasError}
    >
      <PageFrame width="wide">
        {page.returnTo ? (
          <nav aria-label="戦績比較の移動" className={inlineActionGroupClass}>
            {seriesReturnAction(page.returnTo)}
          </nav>
        ) : null}
        <PageContentSurface
          aria-label="戦績比較"
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          role="region"
        >
          {page.normalizationNotice ? (
            <Notice tone="info" title="表示条件を調整しました">
              {page.normalizationNotice}
            </Notice>
          ) : null}
          {options.hasError ? (
            <Notice
              action={
                <Button
                  pending={updating && retryOwner === "options"}
                  pendingLabel="再読み込み中"
                  size="sm"
                  variant={options.hasVisibleData ? "secondary" : "primary"}
                  onClick={() => retry("options")}
                >
                  比較対象を再読み込み
                </Button>
              }
              tone={options.hasVisibleData ? "warning" : "danger"}
              title={
                options.hasVisibleData
                  ? "最新の比較対象を取得できません"
                  : "対象作品を読み込めません"
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
                loading={updating}
                canRefresh={
                  (resource.canRefresh || Boolean(filters.state.gameTitleId)) &&
                  !updating &&
                  !retryOwner
                }
                mapOptions={filters.mapOptions}
                mapValue={filters.state.mapMasterId ?? ""}
                refreshing={updating && !retryOwner && Boolean(resource.data) && !purposeChanging}
                response={
                  matchesSeriesAnalysisScope(resource.data, filters.state)
                    ? resource.data
                    : undefined
                }
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
                refreshing={updating && retryOwner === "status"}
                status={status.data}
                onRefresh={() => retry("status")}
              />
              {(status.loading && !status.data) ||
              (resource.loading &&
                !resource.data &&
                !resource.hasError &&
                status.data?.currentArtifact) ? (
                <ComparisonSkeleton />
              ) : null}
              {!status.loading &&
              status.data?.currentArtifact &&
              resource.hasError &&
              !resource.data ? (
                <Notice
                  action={
                    <Button
                      pending={updating && retryOwner === "resource"}
                      pendingLabel="再読み込み中"
                      size="sm"
                      onClick={() => retry("resource")}
                    >
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
                  {resource.data.scope.matchCount === 0 ? (
                    <StaleShield
                      active={resultsShielded}
                      statusPlacement="external"
                      fallback={<ComparisonSkeleton />}
                      strategy="preserve-inert"
                    >
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
                    </StaleShield>
                  ) : (
                    <SeriesAnalysisContent
                      ownerMetric={filters.state.ownerMetric}
                      onOwnerMetricChange={filters.updateOwnerMetric}
                      activeView={filters.activeView}
                      bundle={resource.bundle}
                      shielded={resultsShielded}
                      navigationReady={
                        !resource.loading &&
                        !resource.shielded &&
                        !focus.shielded &&
                        !focus.loading &&
                        resource.bundle.view === filters.activeView &&
                        matchesSeriesAnalysisScope(resource.data, filters.state)
                      }
                      onArtifactExpired={page.actions.refresh}
                      onClearFocusedMatch={page.actions.clearFocusedMatch}
                      onFocusMatch={page.actions.focusMatch}
                      onViewChange={filters.updateView}
                    />
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </PageContentSurface>
      </PageFrame>
    </SeriesAnalysisNavigation>
  );
}
