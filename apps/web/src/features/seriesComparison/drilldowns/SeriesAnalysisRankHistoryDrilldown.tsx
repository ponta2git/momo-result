import {
  AnalysisTableCell as TableCell,
  AnalysisTableHead as TableHead,
  AnalysisTableRow as TableRow,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatDateTime,
  formatDecimal,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesAnalysisDrilldownV3 } from "@/shared/api/seriesAnalysis";
import { formatMatchNoInEvent, formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { FactList } from "@/shared/ui/data/FactList";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

import { ChangeBadge, deltaDirection, rankDeltaLabel } from "./SeriesAnalysisChangeBadge";

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
  const qualityAdvisory = qualityAdvisoryLabel(payload.summary.qualityStatus);
  return (
    <div className="grid gap-4">
      <FactList
        ariaLabel={`${playerName}の平均順位推移の要約`}
        columns={4}
        items={[
          { id: "target", label: "対象", value: `${payload.summary.targetCount}戦` },
          {
            id: "current",
            label: "現在",
            value: `${formatDecimal(payload.summary.currentAverageRank)}位`,
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
          ...(qualityAdvisory
            ? [
                {
                  id: "quality",
                  label: payload.summary.qualityStatus === "reference" ? "注意" : "状態",
                  value: <SeriesAnalysisQualityAdvisory status={payload.summary.qualityStatus} />,
                },
              ]
            : []),
        ]}
        layout="segmented"
      />
      <DataVizLineChart
        ariaLabel={`${playerName}の累積平均順位の推移`}
        domain={[1, 4]}
        formatIndex={formatSeriesMatchIndex}
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
              <TableHead>開催日時</TableHead>
              <TableHead>順位列</TableHead>
              <TableHead>開催平均</TableHead>
              <TableHead>開催内変化</TableHead>
              <TableHead>通算平均の変化</TableHead>
            </tr>
          </thead>
          <tbody>
            {payload.eventRows.map((row) => (
              <TableRow key={row.heldEventId}>
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
              </TableRow>
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
              <TableRow key={row.itemId}>
                <TableCell>
                  <SeriesAnalysisMatchLink
                    ariaLabel={`${formatSeriesMatchIndex(row.matchIndex)}の試合結果を見る`}
                    matchId={row.matchId}
                  >
                    {formatSeriesMatchIndex(row.matchIndex)}
                  </SeriesAnalysisMatchLink>
                </TableCell>
                <TableCell>{formatDateTime(row.playedAt)}</TableCell>
                <TableCell>{formatMatchNoInEvent(row.matchNoInEvent)}</TableCell>
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
              </TableRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
