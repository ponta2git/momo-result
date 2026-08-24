import {
  AnalysisTableCell as TableCell,
  AnalysisTableHead as TableHead,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatDateTime,
  formatDecimal,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

import { ChangeBadge, deltaDirection, rankDeltaLabel } from "./SeriesAnalysisChangeBadge";
import { DrilldownFacts } from "./SeriesAnalysisDrilldownPrimitives";

type RankHistoryPayload = Extract<
  SeriesAnalysisDrilldownV3["payload"],
  { kind: "rank_average_history" }
>;

export function RankHistoryDrilldown({
  payload,
  playerName,
}: {
  payload: RankHistoryPayload;
  playerName: string;
}) {
  return (
    <div className="grid gap-4">
      <DrilldownFacts
        ariaLabel={`${playerName}の平均順位推移の要約`}
        items={[
          { id: "target", label: "対象", value: `${payload.summary.targetCount}戦` },
          {
            id: "current",
            label: "現在",
            value: `${formatDecimal(payload.summary.currentAverageRank)}位`,
          },
          {
            id: "since-first",
            label: "初戦後からの通算変化",
            value: (
              <ChangeBadge
                direction={deltaDirection(payload.summary.averageRankDeltaFromFirst)}
                magnitude={payload.summary.averageRankDeltaFromFirst}
              />
            ),
          },
          {
            id: "latest-event",
            label: "直近開催での通算変化",
            value: (
              <ChangeBadge
                direction={deltaDirection(payload.summary.latestHeldEventAverageRankDelta)}
                magnitude={payload.summary.latestHeldEventAverageRankDelta}
              />
            ),
          },
          {
            id: "quality",
            label: "読み取り",
            value: qualityLabel(payload.summary.qualityStatus),
          },
        ]}
      />
      <DataVizLineChart
        ariaLabel={`${playerName}の累積平均順位の推移`}
        domain={[1, 4]}
        formatValue={(value) => `${formatDecimal(value)}位`}
        lowValueAtTop
        minimumYStep={0.5}
        series={[
          {
            id: "rank-average",
            points: payload.matchRows.map((row) => ({
              index: row.matchIndex,
              itemId: row.itemId,
              value: row.cumulativeAverageRank,
            })),
          },
        ]}
        seriesIdentity={[{ id: "rank-average", label: playerName }]}
        xAxisLabel="対戦順"
        yAxisLabel="累積平均順位"
        yTicks={[1, 2, 3, 4]}
      />
      <div className="overflow-x-auto">
        <table
          aria-label={`${playerName}の開催別平均順位`}
          className="w-full min-w-[48rem] text-left text-sm"
        >
          <thead>
            <tr>
              <TableHead>開催</TableHead>
              <TableHead>初回日時</TableHead>
              <TableHead>順位列</TableHead>
              <TableHead>開催平均</TableHead>
              <TableHead>開催内変化</TableHead>
              <TableHead>通算平均の変化</TableHead>
            </tr>
          </thead>
          <tbody>
            {payload.eventRows.map((row) => (
              <tr className="border-t border-[var(--color-border)]" key={row.heldEventId}>
                <TableCell>{row.heldEventId}</TableCell>
                <TableCell>{formatDateTime(row.firstPlayedAt)}</TableCell>
                <TableCell>{row.ranks.join(" → ")}</TableCell>
                <TableCell>{formatDecimal(row.eventAverageRank)}位</TableCell>
                <TableCell>
                  <ChangeBadge
                    direction={deltaDirection(row.eventRankDelta)}
                    magnitude={row.eventRankDelta}
                  />
                </TableCell>
                <TableCell>
                  <span className="mr-2 tabular-nums">
                    {formatDecimal(row.cumulativeAverageBefore)}位 →{" "}
                    {formatDecimal(row.cumulativeAverageAfter)}位
                  </span>
                  <ChangeBadge
                    direction={deltaDirection(row.cumulativeAverageDelta)}
                    magnitude={row.cumulativeAverageDelta}
                  />
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[54rem] text-left text-sm">
          <thead>
            <tr>
              <TableHead>試合</TableHead>
              <TableHead>日時</TableHead>
              <TableHead>開催内</TableHead>
              <TableHead>順位</TableHead>
              <TableHead>通算平均</TableHead>
              <TableHead>変化</TableHead>
            </tr>
          </thead>
          <tbody>
            {payload.matchRows.map((row) => (
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
                <TableCell>
                  <RankBadge rank={row.rank} />
                </TableCell>
                <TableCell>{formatDecimal(row.cumulativeAverageRank)}位</TableCell>
                <TableCell>
                  <div className="grid gap-1">
                    <ChangeBadge
                      direction={row.changeDirection}
                      magnitude={row.cumulativeAverageRankDelta}
                    />
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      順位 {rankDeltaLabel(row.rankDelta)}
                    </span>
                  </div>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
