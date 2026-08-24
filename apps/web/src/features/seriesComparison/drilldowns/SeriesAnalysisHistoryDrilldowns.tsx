import {
  AnalysisTableCell as TableCell,
  AnalysisTableHead as TableHead,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  directionLabel,
  formatDateTime,
  formatDecimal,
  formatPercent,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import type { SeriesAnalysisDrilldownV2 } from "@/shared/api/seriesAnalysis";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

import { DrilldownFacts } from "./SeriesAnalysisDrilldownPrimitives";

type RankHistoryPayload = Extract<
  SeriesAnalysisDrilldownV2["payload"],
  { kind: "rank_average_history" }
>;
type PlayOrderHistoryPayload = Extract<
  SeriesAnalysisDrilldownV2["payload"],
  { kind: "play_order_rank_history" }
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
        series={[1, 2, 3, 4].map((playOrder) => ({
          id: `play-order-${playOrder}`,
          points: payload.seriesByPlayOrder
            .filter((row) => row.playOrder === playOrder)
            .map((row) => ({
              index: row.matchIndex,
              itemId: row.itemId,
              value: row.cumulativeAverageRank,
            })),
        }))}
        seriesIdentity={[1, 2, 3, 4].map((playOrder) => ({
          id: `play-order-${playOrder}`,
          label: `${playOrder}番手`,
        }))}
        xAxisLabel="対戦順"
        yAxisLabel="番手内の累積平均順位"
        yTicks={[1, 2, 3, 4]}
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

function ChangeBadge({
  direction,
  magnitude,
}: {
  direction: "declined" | "first_observation" | "improved" | "unavailable" | "unchanged";
  magnitude: number | null;
}) {
  const absoluteMagnitude = magnitude !== null && magnitude < 0 ? -magnitude : magnitude;
  const value = absoluteMagnitude === null ? "" : `${formatDecimal(absoluteMagnitude)} `;
  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center rounded-[var(--radius-xs)] border px-2 py-0.5 text-xs font-semibold tabular-nums ${changeTone(direction)}`}
    >
      {value}
      {directionLabel(direction)}
    </span>
  );
}

function changeTone(direction: ChangeBadgeProps["direction"]): string {
  if (direction === "improved") {
    return "border-[var(--color-success)]/45 bg-[var(--color-success)]/10";
  }
  if (direction === "declined") {
    return "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]";
}

type ChangeBadgeProps = Parameters<typeof ChangeBadge>[0];

function rankDeltaLabel(delta: number | null): string {
  if (delta === null) return "初戦";
  if (delta === 0) return "0位・維持";
  return `${delta < 0 ? -delta : delta}位・${delta < 0 ? "改善" : "後退"}`;
}

function deltaDirection(value: number | null): ChangeBadgeProps["direction"] {
  if (value === null) return "unavailable";
  if (value < 0) return "improved";
  if (value > 0) return "declined";
  return "unchanged";
}

function formatSignedDecimal(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${formatDecimal(value)}`;
}
