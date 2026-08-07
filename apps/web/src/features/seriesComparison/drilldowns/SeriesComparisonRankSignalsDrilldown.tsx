import {
  DrilldownContentSkeleton,
  DrilldownLoadNotice,
  DrilldownPlayerSelector,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import { RankSignalsDetails } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankSignalsDetails";
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

export function RankSignalsDrilldownDialog({
  onMemberChange,
  onOpenChange,
  open,
  response,
  selectedMemberId,
}: {
  onMemberChange: (memberId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  response: SeriesComparisonResponse;
  selectedMemberId: string | null;
}) {
  const { drilldownQuery, players, selectedPlayer } = useSeriesComparisonDrilldownQuery({
    metricId: "rankAnalysis.rankSignals",
    open,
    response,
    selectedMemberId,
  });
  const data = drilldownQuery.data;
  const payload = data?.rankSignals;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const showCachedError = Boolean(data && shouldShowQueryError(drilldownQuery));
  const retry = () => void drilldownQuery.refetch();
  const title = selectedPlayer
    ? `順位を読む手掛かり: ${selectedPlayer.displayName}`
    : "順位を読む手掛かり";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="開催を5組に分けた別開催テストで、同じ手掛かりが繰り返し現れるかを確かめます。"
      open={open}
      popupClassName="max-w-[min(76rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <DrilldownPlayerSelector
          players={players}
          selectedMemberId={selectedPlayer?.memberId}
          onMemberChange={onMemberChange}
        />
        {loading ? (
          <DrilldownContentSkeleton label="順位の手掛かりを読み込み中" />
        ) : showError ? (
          <DrilldownLoadNotice
            description="順位の手掛かりの取得に失敗しました。通信状態を確認して、もう一度お試しください。"
            pending={drilldownQuery.isFetching}
            title="詳細を表示できません"
            onRetry={retry}
          />
        ) : data ? (
          <StaleShield
            active={drilldownQuery.isFetching}
            busyLabel="順位の手掛かりを更新中"
            className="h-full min-h-0"
            contentClassName="h-full min-h-0"
            fallback={<DrilldownContentSkeleton label="順位の手掛かりを読み込み中" />}
            preserveContent
          >
            <div className="grid h-full min-h-0 content-start gap-3 overflow-y-auto overscroll-contain pr-1">
              {showCachedError ? (
                <DrilldownLoadNotice
                  description="直前に取得した詳細を表示しています。"
                  title="最新の詳細を取得できません"
                  tone="warning"
                  onRetry={retry}
                />
              ) : null}
              {payload ? (
                <RankSignalsDetails payload={payload} />
              ) : (
                <RankSignalsPayloadNotice onRetry={retry} />
              )}
            </div>
          </StaleShield>
        ) : (
          <EmptyState
            description="プレーヤーを選択すると詳細を取得します。"
            title="詳細がありません"
          />
        )}
      </div>
    </Dialog>
  );
}

function RankSignalsPayloadNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <DrilldownLoadNotice
      description="順位の手掛かりの形式が想定と異なります。"
      title="詳細を表示できません"
      onRetry={onRetry}
    />
  );
}
