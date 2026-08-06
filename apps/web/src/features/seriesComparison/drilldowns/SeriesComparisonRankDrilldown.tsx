import { LoaderCircle } from "lucide-react";

import { DrilldownPlayerSelector } from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import { RankHistorySummary } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownSummary";
import {
  HeldEventHistoryTable,
  MatchHistoryTable,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTables";
import type { RankDrilldownView } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTypes";
import { useSeriesComparisonDrilldownQuery } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownQuery";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";

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
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-sm font-medium text-[var(--color-text-secondary)]">
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            履歴を読み込み中
          </div>
        ) : showError ? (
          <Notice title="履歴を表示できません" tone="danger">
            順位履歴の取得に失敗しました。時間をおいて再読み込みしてください。
          </Notice>
        ) : data ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {payload ? (
              <>
                <RankHistorySummary data={payload} />
                {view === "events" ? (
                  <HeldEventHistoryTable rows={payload.heldEventRows ?? []} />
                ) : (
                  <MatchHistoryTable rows={payload.matchRows ?? []} />
                )}
              </>
            ) : (
              <Notice title="履歴を表示できません" tone="danger">
                順位履歴の形式が想定と異なります。再読み込みしてください。
              </Notice>
            )}
          </div>
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
