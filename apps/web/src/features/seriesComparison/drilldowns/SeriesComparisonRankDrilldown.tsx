import {
  DrilldownContentSkeleton,
  DrilldownLoadNotice,
  DrilldownPlayerSelector,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import { RankHistorySummary } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownSummary";
import {
  HeldEventHistoryTable,
  MatchHistoryTable,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTables";
import type { RankDrilldownView } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTypes";
import { useSeriesComparisonDrilldownQuery } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownQuery";
import {
  isInitialQueryLoading,
  shouldShowBlockingQueryError,
  shouldShowQueryError,
} from "@/shared/api/queryErrorState";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { StaleShield } from "@/shared/ui/motion/StaleShield";

export function RankAverageHistoryDrilldownDialog({
  onMemberChange,
  onOpenChange,
  open,
  response,
  selectedMemberId,
  view,
  onViewChange,
}: {
  onMemberChange: (memberId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
  view: RankDrilldownView;
  onViewChange: (view: RankDrilldownView) => void;
}) {
  const { drilldownQuery, players, selectedPlayer } = useSeriesComparisonDrilldownQuery({
    metricId: "rank.averageHistory",
    open,
    response,
    selectedMemberId,
  });
  const data = drilldownQuery.data;
  const payload = data?.rankAverageHistory;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const showCachedError = Boolean(data && shouldShowQueryError(drilldownQuery));
  const retry = () => void drilldownQuery.refetch();
  const title = selectedPlayer ? `順位の地力: ${selectedPlayer.displayName}` : "順位の地力";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="各試合の順位と累積平均順位から、改善・後退の転換点を示します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:p-5"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <DrilldownPlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
          <SegmentedControl
            label="履歴表示"
            options={[
              { label: "開催ごと", value: "events" },
              { label: "試合ごと", value: "matches" },
            ]}
            value={view}
            onValueChange={(next) => onViewChange(next as RankDrilldownView)}
          />
        </div>
        {loading ? (
          <DrilldownContentSkeleton label="順位履歴を読み込み中" />
        ) : showError ? (
          <DrilldownLoadNotice
            description="順位履歴の取得に失敗しました。通信状態を確認して、もう一度お試しください。"
            pending={drilldownQuery.isFetching}
            title="履歴を表示できません"
            onRetry={retry}
          />
        ) : data ? (
          <StaleShield
            active={drilldownQuery.isFetching}
            busyLabel="順位履歴を更新中"
            className="h-full min-h-0"
            contentClassName="h-full min-h-0"
            fallback={<DrilldownContentSkeleton label="順位履歴を読み込み中" />}
            preserveContent
          >
            <div className="grid h-full min-h-0 gap-3">
              {showCachedError ? (
                <DrilldownLoadNotice
                  description="直前に取得した順位履歴を表示しています。"
                  title="最新の順位履歴を取得できません"
                  tone="warning"
                  onRetry={retry}
                />
              ) : null}
              {payload ? (
                <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
                  <RankHistorySummary data={payload} />
                  {view === "events" ? (
                    <HeldEventHistoryTable rows={payload.heldEventRows ?? []} />
                  ) : (
                    <MatchHistoryTable rows={payload.matchRows ?? []} />
                  )}
                </div>
              ) : (
                <DrilldownLoadNotice
                  description="順位履歴の形式が想定と異なります。"
                  title="履歴を表示できません"
                  onRetry={retry}
                />
              )}
            </div>
          </StaleShield>
        ) : (
          <EmptyState
            title="履歴がありません"
            description="プレーヤーを選択すると履歴を取得します。"
          />
        )}
      </div>
    </Dialog>
  );
}
