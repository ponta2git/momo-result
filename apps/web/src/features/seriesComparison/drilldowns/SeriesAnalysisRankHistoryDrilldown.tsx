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
import { DataTable } from "@/shared/ui/data/DataTable";
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
      <DataTable
        caption={{ content: `${playerName}の開催別平均順位` }}
        columns={[
          {
            tabular: true,
            header: "開催日時",
            key: "event-date",
            renderCell: (row) => formatDateTime(row.firstPlayedAt),
            rowHeader: true,
          },
          {
            tabular: true,
            header: "順位列",
            key: "ranks",
            renderCell: (row) => row.ranks.join(" → "),
          },
          {
            tabular: true,
            header: "開催平均",
            key: "event-average",
            renderCell: (row) => `${formatDecimal(row.eventAverageRank)}位`,
          },
          {
            header: "開催内変化",
            key: "event-change",
            renderCell: (row) => (
              <ChangeBadge
                direction={deltaDirection(row.eventRankDelta)}
                magnitude={row.eventRankDelta}
              />
            ),
          },
          {
            tabular: true,
            header: "通算平均の変化",
            key: "cumulative-change",
            renderCell: (row) => (
              <>
                <span className="mr-2">
                  {formatDecimal(row.cumulativeAverageBefore)}位 →{" "}
                  {formatDecimal(row.cumulativeAverageAfter)}位
                </span>
                <ChangeBadge
                  direction={deltaDirection(row.cumulativeAverageDelta)}
                  magnitude={row.cumulativeAverageDelta}
                />
              </>
            ),
          },
        ]}
        density="compact"
        getRowKey={(row) => row.heldEventId}
        minWidth="48rem"
        rows={payload.eventRows}
      />
      <DataTable
        caption={{ content: `${playerName}の試合別平均順位推移` }}
        columns={[
          {
            tabular: true,
            header: "試合",
            key: "match",
            renderCell: (row) => (
              <SeriesAnalysisMatchLink
                ariaLabel={`${formatSeriesMatchIndex(row.matchIndex)}の試合結果を見る`}
                matchId={row.matchId}
                presentation="text"
              >
                {formatSeriesMatchIndex(row.matchIndex)}
              </SeriesAnalysisMatchLink>
            ),
            rowHeader: true,
          },
          {
            tabular: true,
            header: "日時",
            key: "played-at",
            renderCell: (row) => formatDateTime(row.playedAt),
          },
          {
            tabular: true,
            header: "開催内",
            key: "event-match",
            renderCell: (row) => formatMatchNoInEvent(row.matchNoInEvent),
          },
          {
            header: "順位",
            key: "rank",
            renderCell: (row) => <RankBadge rank={row.rank} />,
          },
          {
            tabular: true,
            header: "通算平均",
            key: "cumulative-average",
            renderCell: (row) => `${formatDecimal(row.cumulativeAverageRank)}位`,
          },
          {
            header: "変化",
            key: "change",
            renderCell: (row) => (
              <div className="grid gap-1">
                <ChangeBadge
                  direction={row.changeDirection}
                  magnitude={row.cumulativeAverageRankDelta}
                />
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  順位 {rankDeltaLabel(row.rankDelta)}
                </span>
              </div>
            ),
          },
        ]}
        density="compact"
        getRowKey={(row) => row.itemId}
        minWidth="54rem"
        rows={payload.matchRows}
      />
    </div>
  );
}
