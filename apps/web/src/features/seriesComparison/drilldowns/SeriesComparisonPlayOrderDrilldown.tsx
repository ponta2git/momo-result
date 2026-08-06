import {
  DrilldownContentSkeleton,
  DrilldownLoadNotice,
  DrilldownPlayerSelector,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type { PlayOrderTableView } from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderDrilldownTypes";
import { PlayOrderSummary } from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderSummary";
import { AverageTrendPanel } from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderTrendPanel";
import { useSeriesComparisonDrilldownQuery } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownQuery";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function PlayOrderRankHistoryDrilldownDialog({
  onMemberChange,
  onOpenChange,
  open,
  response,
  selectedMemberId,
  tableView,
  onTableViewChange,
}: {
  onMemberChange: (memberId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
  tableView: PlayOrderTableView;
  onTableViewChange: (view: PlayOrderTableView) => void;
}) {
  const { drilldownQuery, players, selectedPlayer } = useSeriesComparisonDrilldownQuery({
    metricId: "playOrder.rankHistory",
    open,
    response,
    selectedMemberId,
  });
  const data = drilldownQuery.data;
  const payload = data?.playOrderRankHistory;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const showCachedError = Boolean(data && shouldShowQueryError(drilldownQuery));
  const retry = () => void drilldownQuery.refetch();
  const title = selectedPlayer ? `番手別成績: ${selectedPlayer.displayName}` : "番手別成績";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="番手ごとの累積平均順位から、試合を重ねても残る得意・苦手を示します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div
        aria-label="番手別履歴の内容"
        className="grid h-full min-h-0 grid-rows-[auto_auto] gap-3 overflow-y-auto overscroll-contain lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden"
        role="region"
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)] lg:items-start">
          <DrilldownPlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
        </div>
        {loading ? (
          <DrilldownContentSkeleton label="番手履歴を読み込み中" />
        ) : showError ? (
          <DrilldownLoadNotice
            description="番手履歴の取得に失敗しました。通信状態を確認して、もう一度お試しください。"
            pending={drilldownQuery.isFetching}
            title="番手履歴を表示できません"
            onRetry={retry}
          />
        ) : data ? (
          <StaleShield
            active={drilldownQuery.isFetching}
            busyLabel="番手履歴を更新中"
            className="h-full min-h-0"
            contentClassName="h-full min-h-0"
            fallback={<DrilldownContentSkeleton label="番手履歴を読み込み中" />}
            preserveContent
          >
            <div className="grid h-full min-h-0 gap-3">
              {showCachedError ? (
                <DrilldownLoadNotice
                  description="直前に取得した番手履歴を表示しています。"
                  title="最新の番手履歴を取得できません"
                  tone="warning"
                  onRetry={retry}
                />
              ) : null}
              {payload ? (
                <div className="grid min-h-0 grid-rows-[auto_auto] gap-3 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)]">
                  <PlayOrderSummary data={payload} />
                  <AverageTrendPanel
                    payload={payload}
                    tableView={tableView}
                    onTableViewChange={onTableViewChange}
                  />
                </div>
              ) : (
                <DrilldownLoadNotice
                  description="番手履歴の形式が想定と異なります。"
                  title="番手履歴を表示できません"
                  onRetry={retry}
                />
              )}
            </div>
          </StaleShield>
        ) : (
          <EmptyState
            title="番手履歴がありません"
            description="プレーヤーを選択すると番手履歴を取得します。"
          />
        )}
      </div>
    </Dialog>
  );
}
