import {
  AnalysisTableCell as TableCell,
  AnalysisTableHead as TableHead,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import { drilldownTitle } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import {
  PlayOrderHistoryDrilldown,
  RankHistoryDrilldown,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisHistoryDrilldowns";
import { RankSignalDrilldown } from "@/features/seriesComparison/drilldowns/SeriesAnalysisRankSignalDrilldown";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import {
  formatDateTime,
  formatDecimal,
  formatManYen,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type {
  SeriesAnalysisDrilldownMetricId,
  SeriesAnalysisDrilldownV3,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { Button } from "@/shared/ui/actions/Button";
import { FactList } from "@/shared/ui/data/FactList";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";

export type SeriesAnalysisDrilldownSelection = {
  memberId: string;
  metricId: SeriesAnalysisDrilldownMetricId;
};

export function SeriesAnalysisDrilldownDialog({
  baseQuery,
  onArtifactExpired,
  onClose,
  selection,
}: {
  baseQuery: SeriesAnalysisQuery;
  onArtifactExpired: () => void;
  onClose: () => void;
  selection: SeriesAnalysisDrilldownSelection | null;
}) {
  const query = useSeriesAnalysisDrilldown({ baseQuery, onArtifactExpired, selection });

  return (
    <Dialog
      className="overflow-y-auto"
      description={query.data?.player.displayName ?? "比較に使った試合を確認します。"}
      open={selection !== null}
      popupClassName="max-w-[64rem]"
      title={selection ? drilldownTitle(selection.metricId) : "分析の詳細"}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {query.isPending ? (
        <div aria-label="詳細を読み込み中" className="grid gap-3">
          <Skeleton className="min-h-12" />
          <Skeleton className="min-h-40" />
        </div>
      ) : query.isError ? (
        <Notice tone="danger" title="詳細を読み込めません">
          <p>比較の詳細を取得できませんでした。</p>
          <div className="mt-3">
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              再読み込み
            </Button>
          </div>
        </Notice>
      ) : query.data ? (
        <DrilldownBody response={query.data} />
      ) : null}
    </Dialog>
  );
}

function DrilldownBody({ response }: { response: SeriesAnalysisDrilldownV3 }) {
  const payload = response.payload;
  switch (payload.kind) {
    case "rank_average_history":
      return <RankHistoryDrilldown payload={payload} playerName={response.player.displayName} />;
    case "play_order_rank_history":
      return (
        <PlayOrderHistoryDrilldown payload={payload} playerName={response.player.displayName} />
      );
    case "rank_signals":
      return <RankSignalDrilldown payload={payload} />;
    case "unexpected_wins":
      return <UnexpectedWinsDrilldown payload={payload} />;
  }
}

export function UnexpectedWinsDrilldown({
  payload,
}: {
  payload: Extract<SeriesAnalysisDrilldownV3["payload"], { kind: "unexpected_wins" }>;
}) {
  const qualityAdvisory = qualityAdvisoryLabel(payload.summary.status);
  return (
    <div className="grid gap-4">
      <FactList
        ariaLabel="予測より上位だった勝利の要約"
        columns={4}
        items={[
          {
            id: "wins",
            label: "勝利",
            value: `${payload.summary.totalWinCount}戦`,
          },
          {
            id: "targets",
            label: "確認対象",
            value: `${payload.summary.unexpectedWinCount}戦`,
          },
          ...(qualityAdvisory
            ? [
                {
                  id: "quality",
                  label: payload.summary.status === "reference" ? "注意" : "状態",
                  value: <SeriesAnalysisQualityAdvisory status={payload.summary.status} />,
                },
              ]
            : []),
        ]}
        layout="segmented"
      />
      {payload.rows.length === 0 ? (
        <Notice tone="info" title="予測より上位だった勝利はありません">
          この比較範囲では、確認対象になった勝利はありません。
        </Notice>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>試合</TableHead>
                <TableHead>日時</TableHead>
                <TableHead>期待順位</TableHead>
                <TableHead>実順位</TableHead>
                <TableHead>物件収益</TableHead>
                <TableHead>目的地</TableHead>
                <TableHead>プラス駅</TableHead>
                <TableHead>マイナス駅</TableHead>
                <TableHead>カード駅</TableHead>
                <TableHead>カード売り場</TableHead>
                <TableHead>スリの銀次</TableHead>
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row) => (
                <tr className="border-t border-[var(--color-border)]" key={row.matchId}>
                  <TableCell>
                    <SeriesAnalysisMatchLink
                      ariaLabel={`${formatSeriesMatchIndex(row.matchIndex)}の試合結果を見る`}
                      matchId={row.matchId}
                    >
                      {formatSeriesMatchIndex(row.matchIndex)}
                    </SeriesAnalysisMatchLink>
                  </TableCell>
                  <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                  <TableCell>{formatDecimal(row.expectedRank)}位</TableCell>
                  <TableCell>{row.actualRank}位</TableCell>
                  <TableCell>{formatManYen(row.evidence.revenueManYen)}</TableCell>
                  <TableCell>{row.evidence.destinationCount}回</TableCell>
                  <TableCell>{row.evidence.plusStationCount}回</TableCell>
                  <TableCell>{row.evidence.minusStationCount}回</TableCell>
                  <TableCell>{row.evidence.cardStationCount}回</TableCell>
                  <TableCell>{row.evidence.cardShopCount}回</TableCell>
                  <TableCell>{row.evidence.ginjiCount}回</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
