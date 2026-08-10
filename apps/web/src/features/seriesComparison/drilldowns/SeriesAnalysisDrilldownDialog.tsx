import {
  drilldownTitle,
  SummaryLine,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import {
  directionLabel,
  formatDateTime,
  formatDecimal,
  formatPercent,
  qualityLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type {
  SeriesAnalysisDrilldownMetricId,
  SeriesAnalysisDrilldownV2,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
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
      description={query.data?.player.displayName ?? "保存済み成果物の詳細を表示します。"}
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
          <p>保存済みの詳細を取得できませんでした。</p>
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

function DrilldownBody({ response }: { response: SeriesAnalysisDrilldownV2 }) {
  const payload = response.payload;
  switch (payload.kind) {
    case "rank_average_history":
      return (
        <div className="grid gap-4">
          <SummaryLine
            items={[
              `対象 ${payload.summary.targetCount}戦`,
              `現在 ${formatDecimal(payload.summary.currentAverageRank)}位`,
              qualityLabel(payload.summary.qualityStatus),
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead>
                <tr>
                  <TableHead>試合</TableHead>
                  <TableHead>日時</TableHead>
                  <TableHead>順位</TableHead>
                  <TableHead>通算平均</TableHead>
                  <TableHead>変化</TableHead>
                </tr>
              </thead>
              <tbody>
                {payload.matchRows.map((row) => (
                  <tr className="border-t border-[var(--color-border)]" key={row.itemId}>
                    <TableCell>第{row.matchIndex}戦</TableCell>
                    <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                    <TableCell>{row.rank}位</TableCell>
                    <TableCell>{formatDecimal(row.cumulativeAverageRank)}位</TableCell>
                    <TableCell>{directionLabel(row.changeDirection)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "play_order_rank_history":
      return (
        <div className="grid gap-4">
          <SummaryLine
            items={[
              `対象 ${payload.summary.targetCount}戦`,
              `現在 ${formatDecimal(payload.summary.currentAverageRank)}位`,
              qualityLabel(payload.summary.qualityStatus),
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {payload.rows.map((row) => (
              <div
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
                key={row.playOrder}
              >
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {row.playOrder}番手・{row.targetCount}戦
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {formatDecimal(row.rankAverage)}位
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  入賞 {formatPercent(row.podiumRate)} / 下位 {formatPercent(row.lowerHalfRate)}
                </p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead>
                <tr>
                  <TableHead>試合</TableHead>
                  <TableHead>日時</TableHead>
                  <TableHead>番手</TableHead>
                  <TableHead>順位</TableHead>
                  <TableHead>番手別通算</TableHead>
                  <TableHead>変化</TableHead>
                </tr>
              </thead>
              <tbody>
                {payload.seriesByPlayOrder.map((row) => (
                  <tr className="border-t border-[var(--color-border)]" key={row.itemId}>
                    <TableCell>第{row.matchIndex}戦</TableCell>
                    <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                    <TableCell>{row.playOrder}番手</TableCell>
                    <TableCell>{row.rank}位</TableCell>
                    <TableCell>{formatDecimal(row.cumulativeAverageRank)}位</TableCell>
                    <TableCell>{directionLabel(row.changeDirection)}</TableCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    case "rank_signals":
      return (
        <div className="grid gap-4">
          <SummaryLine
            items={[
              qualityLabel(payload.status),
              `${payload.matchCount}戦`,
              `${payload.heldEventCount}開催`,
              `改善fold ${payload.improvedFoldCount}/${payload.method.foldCount}`,
            ]}
          />
          {payload.candidates.length === 0 ? (
            <Notice tone="info" title="採用できる手掛かりはありません">
              モデル品質とfold支持を満たした候補だけを表示します。
            </Notice>
          ) : (
            <div className="grid gap-3">
              {payload.candidates.map((candidate) => (
                <article
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
                  key={candidate.signal}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{rankSignalLabel(candidate.signal)}</h3>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      支持 {candidate.supportCount}/{payload.method.foldCount}・安定性{" "}
                      {candidate.stabilityBand}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">
                    寄与度 {formatDecimal(candidate.importance)} / 候補内{" "}
                    {candidate.candidateSharePercent === null
                      ? "—"
                      : `${candidate.candidateSharePercent}%`}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[32rem] text-left text-xs">
                      <thead>
                        <tr>
                          <TableHead>fold</TableHead>
                          <TableHead>開催</TableHead>
                          <TableHead>比較</TableHead>
                          <TableHead>寄与度</TableHead>
                          <TableHead>支持</TableHead>
                        </tr>
                      </thead>
                      <tbody>
                        {candidate.foldRows.map((row) => (
                          <tr className="border-t border-[var(--color-border)]" key={row.fold}>
                            <TableCell>{row.fold}</TableCell>
                            <TableCell>{row.heldEventCount}</TableCell>
                            <TableCell>{row.comparisonCount}</TableCell>
                            <TableCell>{formatDecimal(row.importance)}</TableCell>
                            <TableCell>{row.supported ? "あり" : "なし"}</TableCell>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      );
    case "unexpected_wins":
      return (
        <div className="grid gap-4">
          <SummaryLine
            items={[
              qualityLabel(payload.summary.status),
              `勝利 ${payload.summary.totalWinCount}戦`,
              `対象 ${payload.summary.unexpectedWinCount}戦`,
            ]}
          />
          {payload.rows.length === 0 ? (
            <Notice tone="info" title="記録外の一撃はありません">
              モデル条件に該当した勝利だけを表示します。
            </Notice>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead>
                  <tr>
                    <TableHead>試合</TableHead>
                    <TableHead>日時</TableHead>
                    <TableHead>期待順位</TableHead>
                    <TableHead>実順位</TableHead>
                    <TableHead>物件収益</TableHead>
                    <TableHead>目的地</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {payload.rows.map((row) => (
                    <tr className="border-t border-[var(--color-border)]" key={row.matchId}>
                      <TableCell>第{row.matchIndex}戦</TableCell>
                      <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                      <TableCell>{formatDecimal(row.expectedRank)}位</TableCell>
                      <TableCell>{row.actualRank}位</TableCell>
                      <TableCell>{row.evidence.revenueManYen}万円</TableCell>
                      <TableCell>{row.evidence.destinationCount}回</TableCell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
  }
}
