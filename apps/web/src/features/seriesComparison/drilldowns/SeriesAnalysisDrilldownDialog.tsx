import {
  drilldownTitle,
  SummaryLine,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownPrimitives";
import {
  PlayOrderHistoryDrilldown,
  RankHistoryDrilldown,
} from "@/features/seriesComparison/drilldowns/SeriesAnalysisHistoryDrilldowns";
import { useSeriesAnalysisDrilldown } from "@/features/seriesComparison/drilldowns/useSeriesAnalysisDrilldown";
import {
  evidenceStrengthLabel,
  formatDateTime,
  formatDecimal,
  formatManYen,
  qualityLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
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
      return <RankHistoryDrilldown payload={payload} playerName={response.player.displayName} />;
    case "play_order_rank_history":
      return (
        <PlayOrderHistoryDrilldown payload={payload} playerName={response.player.displayName} />
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
                      <TableCell>
                        <SeriesAnalysisMatchLink
                          ariaLabel={`第${row.matchIndex}戦の試合結果を見る`}
                          matchId={row.matchId}
                        >
                          第{row.matchIndex}戦
                        </SeriesAnalysisMatchLink>
                      </TableCell>
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
