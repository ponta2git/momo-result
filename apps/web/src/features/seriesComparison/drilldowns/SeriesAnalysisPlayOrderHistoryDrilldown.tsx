import {
  AnalysisTableCell as TableCell,
  AnalysisTableHead as TableHead,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatDateTime,
  formatDecimal,
  formatPercent,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

import { ChangeBadge, formatSignedDecimal } from "./SeriesAnalysisChangeBadge";
import { DrilldownFacts } from "./SeriesAnalysisDrilldownPrimitives";

type PlayOrderHistoryPayload = Extract<
  SeriesAnalysisDrilldownV3["payload"],
  { kind: "play_order_rank_history" }
>;

const PLAY_ORDERS = [1, 2, 3, 4];

export function PlayOrderHistoryDrilldown({
  payload,
  playerName,
}: {
  payload: PlayOrderHistoryPayload;
  playerName: string;
}) {
  return (
    <div className="grid gap-4">
      <DrilldownFacts
        ariaLabel={`${playerName}の番手別順位推移の要約`}
        items={[
          { id: "target", label: "対象", value: `${payload.summary.targetCount}戦` },
          {
            id: "current",
            label: "現在",
            value: `${formatDecimal(payload.summary.currentAverageRank)}位`,
          },
          {
            id: "best",
            label: "最良番手",
            value:
              payload.summary.bestPlayOrder === null
                ? "—"
                : `${payload.summary.bestPlayOrder}番手・${formatDecimal(payload.summary.bestPlayOrderAverageRank)}位`,
          },
          {
            id: "worst",
            label: "最悪番手",
            value:
              payload.summary.worstPlayOrder === null
                ? "—"
                : `${payload.summary.worstPlayOrder}番手・${formatDecimal(payload.summary.worstPlayOrderAverageRank)}位`,
          },
          {
            id: "spread",
            label: "番手間の平均順位差",
            value: `${formatDecimal(payload.summary.spread)}位`,
          },
          {
            id: "quality",
            label: "読み取り",
            value: qualityLabel(payload.summary.qualityStatus),
          },
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
              入賞 {row.podiumCount}戦・{formatPercent(row.podiumRate)} / 下位 {row.lowerHalfCount}
              戦・{formatPercent(row.lowerHalfRate)}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
              全体同番手 {formatDecimal(row.baselineRankAverage)}位・差{" "}
              {formatSignedDecimal(row.baselineDelta)}位
            </p>
          </div>
        ))}
      </div>
      <DataVizLineChart
        ariaLabel={`${playerName}の番手別累積平均順位の推移`}
        domain={[1, 4]}
        formatValue={(value) => `${formatDecimal(value)}位`}
        lowValueAtTop
        minimumYStep={0.5}
        series={PLAY_ORDERS.map((playOrder) => ({
          id: `play-order-${playOrder}`,
          points: payload.seriesByPlayOrder
            .filter((row) => row.playOrder === playOrder)
            .map((row) => ({
              index: row.matchIndex,
              itemId: row.itemId,
              value: row.cumulativeAverageRank,
            })),
        }))}
        seriesIdentity={PLAY_ORDERS.map((playOrder) => ({
          id: `play-order-${playOrder}`,
          label: `${playOrder}番手`,
        }))}
        xAxisLabel="対戦順"
        yAxisLabel="番手内の累積平均順位"
        yTicks={PLAY_ORDERS}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[62rem] text-left text-sm">
          <thead>
            <tr>
              <TableHead>試合</TableHead>
              <TableHead>日時</TableHead>
              <TableHead>開催内</TableHead>
              <TableHead>番手</TableHead>
              <TableHead>番手内</TableHead>
              <TableHead>順位</TableHead>
              <TableHead>番手別通算</TableHead>
              <TableHead>変化</TableHead>
            </tr>
          </thead>
          <tbody>
            {payload.seriesByPlayOrder.map((row) => (
              <tr className="border-t border-[var(--color-border)]" key={row.itemId}>
                <TableCell>
                  <SeriesAnalysisMatchLink
                    ariaLabel={`第${row.matchIndex}戦の試合結果を見る`}
                    matchId={row.matchId}
                  >
                    第{row.matchIndex}戦
                  </SeriesAnalysisMatchLink>
                </TableCell>
                <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                <TableCell>第{row.matchNoInEvent}試合</TableCell>
                <TableCell>{row.playOrder}番手</TableCell>
                <TableCell>{row.occurrenceIndex}戦目</TableCell>
                <TableCell>
                  <RankBadge rank={row.rank} />
                </TableCell>
                <TableCell>{formatDecimal(row.cumulativeAverageRank)}位</TableCell>
                <TableCell>
                  {row.previousCumulativeAverageRank === null ? (
                    <ChangeBadge direction="first_observation" magnitude={null} />
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      <span className="tabular-nums">
                        {formatDecimal(row.previousCumulativeAverageRank)}位 →{" "}
                        {formatDecimal(row.cumulativeAverageRank)}位
                      </span>
                      <ChangeBadge direction={row.changeDirection} magnitude={null} />
                    </span>
                  )}
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
