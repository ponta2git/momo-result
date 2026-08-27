import {
  formatDateTime,
  formatDecimal,
  formatPercent,
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
import { PlayOrderMark, playOrderPresentation } from "@/shared/ui/data/PlayOrderMark";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { playOrderSeriesId } from "@/shared/ui/dataViz/seriesPresentation";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

import { ChangeBadge, formatSignedDecimal } from "./SeriesAnalysisChangeBadge";

type PlayOrderHistoryPayload = Extract<
  SeriesAnalysisDrilldownV3["payload"],
  { kind: "play_order_rank_history" }
>;

const PLAY_ORDERS = [1, 2, 3, 4] as const;

export function PlayOrderHistoryDrilldown({
  payload,
  playerName,
}: {
  payload: PlayOrderHistoryPayload;
  playerName: string;
}) {
  const qualityAdvisory = qualityAdvisoryLabel(payload.summary.qualityStatus);
  return (
    <div className="grid gap-4">
      <FactList
        ariaLabel={`${playerName}の番手別順位推移の要約`}
        columns={4}
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
        layout="inline"
      />
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        {payload.rows.map((row) => (
          <div className="min-w-0" key={row.playOrder}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PlayOrderMark playOrder={row.playOrder} />
              <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                {row.targetCount}戦
              </span>
            </div>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {formatDecimal(row.rankAverage)}位
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              入賞{row.podiumCount}戦・{formatPercent(row.podiumRate)}／下位{row.lowerHalfCount}
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
        formatIndex={formatSeriesMatchIndex}
        formatValue={(value) => `${formatDecimal(value)}位`}
        lowValueAtTop
        minimumYStep={0.5}
        series={PLAY_ORDERS.map((playOrder) => ({
          id: playOrderSeriesId(playOrder),
          points: payload.seriesByPlayOrder
            .filter((row) => row.playOrder === playOrder)
            .map((row) => ({
              index: row.matchIndex,
              itemId: row.itemId,
              value: row.cumulativeAverageRank,
            })),
        }))}
        seriesIdentity={PLAY_ORDERS.map((playOrder) => ({
          id: playOrderSeriesId(playOrder),
          label: playOrderPresentation(playOrder).label,
        }))}
        xAxisLabel="対戦順"
        yAxisLabel="番手内の累積平均順位"
        yTicks={[...PLAY_ORDERS]}
      />
      <DataTable
        caption={{ content: `${playerName}の番手別試合推移` }}
        columns={[
          {
            cellClassName: "tabular-nums",
            header: "試合",
            key: "match",
            renderCell: (row) => (
              <SeriesAnalysisMatchLink
                ariaLabel={`${formatSeriesMatchIndex(row.matchIndex)}の試合結果を見る`}
                matchId={row.matchId}
              >
                {formatSeriesMatchIndex(row.matchIndex)}
              </SeriesAnalysisMatchLink>
            ),
            rowHeader: true,
          },
          {
            cellClassName: "tabular-nums",
            header: "日時",
            key: "played-at",
            renderCell: (row) => formatDateTime(row.playedAt),
          },
          {
            cellClassName: "tabular-nums",
            header: "開催内",
            key: "event-match",
            renderCell: (row) => formatMatchNoInEvent(row.matchNoInEvent),
          },
          {
            header: "番手",
            key: "play-order",
            renderCell: (row) => <PlayOrderMark playOrder={row.playOrder} />,
          },
          {
            cellClassName: "tabular-nums",
            header: "番手内",
            key: "occurrence",
            renderCell: (row) => `${row.occurrenceIndex}戦目`,
          },
          {
            header: "順位",
            key: "rank",
            renderCell: (row) => <RankBadge rank={row.rank} />,
          },
          {
            cellClassName: "tabular-nums",
            header: "番手別通算",
            key: "cumulative-average",
            renderCell: (row) => `${formatDecimal(row.cumulativeAverageRank)}位`,
          },
          {
            header: "変化",
            key: "change",
            renderCell: (row) =>
              row.previousCumulativeAverageRank === null ? (
                <ChangeBadge direction="first_observation" magnitude={null} />
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1">
                  <span className="tabular-nums">
                    {formatDecimal(row.previousCumulativeAverageRank)}位 →{" "}
                    {formatDecimal(row.cumulativeAverageRank)}位
                  </span>
                  <ChangeBadge direction={row.changeDirection} magnitude={null} />
                </span>
              ),
          },
        ]}
        density="compact"
        getRowKey={(row) => row.itemId}
        minWidth="62rem"
        rows={payload.seriesByPlayOrder}
      />
    </div>
  );
}
