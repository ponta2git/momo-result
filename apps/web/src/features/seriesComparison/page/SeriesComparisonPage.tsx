import { BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";

import { matchesSeriesAnalysisScope } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { SeriesAnalysisNavigation } from "@/features/seriesComparison/navigation/SeriesAnalysisNavigation";
import { OutlookWorkspaceProvider } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import {
  preloadSeriesAnalysisView,
  SeriesAnalysisContent,
} from "@/features/seriesComparison/page/SeriesAnalysisContent";
import { SeriesAnalysisScopeBar } from "@/features/seriesComparison/page/SeriesAnalysisScopeBar";
import { SeriesAnalysisStatusFeedback } from "@/features/seriesComparison/page/SeriesAnalysisStatusFeedback";
import { PurposeTabs } from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import {
  ComparisonSkeleton,
  PageSkeleton,
} from "@/features/seriesComparison/page/SeriesComparisonSkeletons";
import { useSeriesComparison } from "@/features/seriesComparison/page/useSeriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function SeriesComparisonPage() {
  return (
    <OutlookWorkspaceProvider>
      <SeriesComparisonPageContent />
    </OutlookWorkspaceProvider>
  );
}

function SeriesComparisonPageContent() {
  const comparison = useSeriesComparison();
  const { filters, focus, options, resource, status } = comparison;
  const purposeChanging =
    resource.bundle !== undefined &&
    (filters.activeView === "outlook"
      ? "outlook"
      : filters.activeView === "review"
        ? "review"
        : "analysis") !== resource.bundle.kind;
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
  const [requestedRetryTarget, setRequestedRetryTarget] = useState<
    "options" | "status" | "resource"
  >();
  const defaultRetryTarget = options.hasError
    ? "options"
    : status.hasError || (!status.loading && !status.data?.currentArtifact)
      ? "status"
      : resource.hasError && !resource.data
        ? "resource"
        : undefined;

  const requestedRetryStillVisible =
    requestedRetryTarget === "options"
      ? options.hasError
      : requestedRetryTarget === "status"
        ? status.hasError || (!status.loading && !status.data?.currentArtifact)
        : requestedRetryTarget === "resource"
          ? resource.hasError && !resource.data
          : false;
  const retryTarget = requestedRetryStillVisible ? requestedRetryTarget : defaultRetryTarget;
  const retry = (target: "options" | "status" | "resource") => {
    setRequestedRetryTarget(target);
    comparison.actions.refresh();
  };

  useEffect(() => {
    if (filters.seriesOptions.length === 0) return;
    preloadSeriesAnalysisView(filters.activeView);
  }, [filters.activeView, filters.seriesOptions.length]);

  if (options.loading) return <PageSkeleton view={filters.activeView} />;

  return (
    <SeriesAnalysisNavigation
      displayIntent={comparison.displayIntent}
      failed={options.hasError || status.hasError || resource.hasError}
    >
      <PageFrame width="wide">
        <PageContentSurface
          aria-label="戦績比較"
          className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
          role="region"
        >
          {comparison.normalizationNotice ? (
            <Notice tone="info" title="表示条件を調整しました">
              {comparison.normalizationNotice}
            </Notice>
          ) : null}
          {options.hasError ? (
            <Notice
              action={
                <Button
                  pending={updating && retryTarget === "options"}
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
                scopeEmpty={resource.scopeState === "empty"}
                loading={updating}
                canRefresh={
                  (resource.canRefresh || Boolean(filters.selection.gameTitleId)) &&
                  !updating &&
                  !retryTarget
                }
                mapOptions={filters.mapOptions}
                mapValue={filters.selection.mapMasterId ?? ""}
                refreshing={updating && !retryTarget && Boolean(resource.data) && !purposeChanging}
                response={
                  matchesSeriesAnalysisScope(resource.data, filters.selection)
                    ? resource.data
                    : undefined
                }
                seasonOptions={filters.seasonOptions}
                seasonValue={filters.selection.seasonMasterId ?? ""}
                seriesOptions={filters.seriesOptions}
                seriesValue={filters.selection.gameTitleId ?? ""}
                onMapChange={filters.updateMapMasterId}
                onRefresh={comparison.actions.refresh}
                onSeasonChange={filters.updateSeasonMasterId}
                onSeriesChange={filters.updateGameTitle}
              />
              <SeriesAnalysisStatusFeedback
                displayedPublishedAt={
                  matchesSeriesAnalysisScope(resource.data, filters.selection)
                    ? resource.data?.artifact.publishedAt
                    : undefined
                }
                confirmedMatchCount={filters.confirmedMatchCount}
                hasError={status.hasError}
                loading={status.loading}
                refreshing={updating && retryTarget === "status"}
                status={status.data}
                onRefresh={() => retry("status")}
              />
              <PurposeTabs activeView={filters.activeView} onViewChange={filters.updateView} />
              {(status.loading && !status.data) ||
              (resource.loading &&
                !resource.data &&
                !resource.hasError &&
                status.data?.currentArtifact) ? (
                <ComparisonSkeleton view={filters.activeView} />
              ) : null}
              {resource.unavailableReason === "outlook_map" ? (
                <Notice
                  tone="info"
                  title="見通しは全マップの総合成績で試します"
                  action={
                    <Button variant="secondary" onClick={() => filters.updateMapMasterId("")}>
                      全マップで試す
                    </Button>
                  }
                >
                  作品とシーズンの選択を保って、マップの指定を解除します。
                </Notice>
              ) : resource.scopeState === "empty" ? (
                <EmptyState
                  placement="embedded"
                  title="この範囲に確定済みの試合がありません"
                  description="シーズン・マップの選択は保持しています。条件を変更すると別の記録を確認できます。"
                  action={
                    <Button variant="secondary" onClick={comparison.actions.clearScope}>
                      全シーズン・全マップに戻す
                    </Button>
                  }
                />
              ) : resource.scopeState === "awaiting_analysis" && status.data?.currentArtifact ? (
                <Notice tone="info" title="この条件の分析を準備しています">
                  記録はありますが、この条件の分析結果はまだ公開されていません。計算後に状態を更新してください。
                </Notice>
              ) : resource.scopeState === "invalid" ? (
                <Notice
                  tone="warning"
                  title="この比較条件は現在利用できません"
                  action={
                    <Button variant="secondary" onClick={comparison.actions.clearScope}>
                      全シーズン・全マップに戻す
                    </Button>
                  }
                >
                  対象のシーズンまたはマップが変更されています。状態を更新すると、現在の条件を確認できます。
                </Notice>
              ) : !status.loading &&
                status.data?.currentArtifact &&
                resource.hasError &&
                !resource.data ? (
                <Notice
                  action={
                    <Button
                      pending={updating && retryTarget === "resource"}
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
                      fallback={<ComparisonSkeleton view={filters.activeView} />}
                      strategy="preserve-inert"
                    >
                      <EmptyState
                        action={
                          filters.selection.mapMasterId || filters.selection.seasonMasterId ? (
                            <Button variant="secondary" onClick={comparison.actions.clearScope}>
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
                      showPurposeTabs={false}
                      outlookSelection={filters.selection}
                      onOutlookMemberChange={filters.updateOutlookMember}
                      ownerMetric={filters.selection.ownerMetric}
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
                        matchesSeriesAnalysisScope(resource.data, filters.selection)
                      }
                      onArtifactExpired={comparison.actions.refresh}
                      onClearFocusedMatch={comparison.actions.clearFocusedMatch}
                      onFocusMatch={comparison.actions.focusMatch}
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
