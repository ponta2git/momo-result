import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { DrilldownPlayerSelector } from "@/features/seriesComparison/SeriesComparisonDrilldownPrimitives";
import type { PlayOrderTableView } from "@/features/seriesComparison/SeriesComparisonPlayOrderDrilldownTypes";
import { PlayOrderSummary } from "@/features/seriesComparison/SeriesComparisonPlayOrderSummary";
import { AverageTrendPanel } from "@/features/seriesComparison/SeriesComparisonPlayOrderTrendPanel";
import { isInitialQueryLoading, shouldShowBlockingQueryError } from "@/shared/api/queryErrorState";
import { seriesComparisonKeys } from "@/shared/api/queryKeys";
import { getSeriesComparisonDrilldown } from "@/shared/api/seriesComparison";
import type {
  SeriesComparisonDrilldownQuery,
  SeriesComparisonResponse,
} from "@/shared/api/seriesComparison";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";

export function PlayOrderRankHistoryDrilldownDialog({
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
  const [tableView, setTableView] = useState<PlayOrderTableView>("trendData");
  const players = response.players ?? [];
  const selectedPlayer =
    players.find((player) => player.memberId === selectedMemberId) ?? players[0] ?? null;
  const query = useMemo<SeriesComparisonDrilldownQuery | undefined>(() => {
    if (!selectedPlayer) {
      return undefined;
    }
    return {
      gameTitleId: response.scope.gameTitleId,
      mapMasterId: response.scope.mapMasterId,
      memberId: selectedPlayer.memberId,
      metricId: "playOrder.rankHistory",
      seasonMasterId: response.scope.seasonMasterId,
    };
  }, [
    response.scope.gameTitleId,
    response.scope.mapMasterId,
    response.scope.seasonMasterId,
    selectedPlayer,
  ]);

  const drilldownQuery = useQuery({
    enabled: open && query !== undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (!query) {
        throw new Error("series comparison play order drilldown query is not ready");
      }
      return getSeriesComparisonDrilldown(query, { signal });
    },
    queryKey: seriesComparisonKeys.drilldown(query),
  });
  const data = drilldownQuery.data;
  const payload = data?.playOrderRankHistory;
  const loading = open && isInitialQueryLoading(drilldownQuery);
  const showError = shouldShowBlockingQueryError(drilldownQuery);
  const title = selectedPlayer ? `番手別成績: ${selectedPlayer.displayName}` : "番手別成績";

  return (
    <Dialog
      className="flex h-full min-h-0 flex-col"
      description="番手ごとの平均順位が、試合を重ねてどう動いたかを確認します。"
      open={open}
      popupClassName="max-w-[min(92rem,calc(100vw-1rem))] items-stretch p-2 sm:p-4"
      surfaceClassName="h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] !overflow-hidden p-4 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:p-5"
      title={title}
      onOpenChange={onOpenChange}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)] lg:items-start">
          <DrilldownPlayerSelector
            players={players}
            selectedMemberId={selectedPlayer?.memberId}
            onMemberChange={onMemberChange}
          />
        </div>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-sm font-medium text-[var(--color-text-secondary)]">
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 size-4 animate-spin motion-reduce:animate-none"
            />
            番手履歴を読み込み中
          </div>
        ) : showError ? (
          <Notice title="番手履歴を表示できません" tone="danger">
            番手履歴の取得に失敗しました。時間をおいて再読み込みしてください。
          </Notice>
        ) : data ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
            {payload ? (
              <>
                <PlayOrderSummary data={payload} />
                <AverageTrendPanel
                  payload={payload}
                  tableView={tableView}
                  onTableViewChange={setTableView}
                />
              </>
            ) : (
              <Notice title="番手履歴を表示できません" tone="danger">
                番手履歴の形式が想定と異なります。再読み込みしてください。
              </Notice>
            )}
          </div>
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
