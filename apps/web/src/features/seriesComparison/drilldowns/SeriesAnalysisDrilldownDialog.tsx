import {
  drilldownTitle,
  SummaryLine,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import {
  directionLabel,
  evidenceStrengthLabel,
  formatDateTime,
  formatDecimal,
  formatManYen,
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
            ]}
          />
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            同じプレーヤー内で残った候補だけを比べています。候補内の比重であり、順位への因果や次戦の結果を示す値ではありません。
          </p>
          {payload.candidates.length === 0 ? (
            <Notice tone="info" title="採用できる手掛かりはありません">
              複数の開催に分けて確認しても残る候補がありませんでした。
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
                      {candidate.supportCount}区分で支持・安定性
                      {evidenceStrengthLabel(candidate.stabilityBand)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm tabular-nums">
                    候補内の比重{" "}
                    {candidate.candidateSharePercent === null
                      ? "—"
                      : `${candidate.candidateSharePercent}%`}
                  </p>
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
            <Notice tone="info" title="予測より上位だった勝利はありません">
              この比較範囲では、確認対象になった勝利はありません。
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
                      <TableCell>{formatManYen(row.evidence.revenueManYen)}</TableCell>
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
