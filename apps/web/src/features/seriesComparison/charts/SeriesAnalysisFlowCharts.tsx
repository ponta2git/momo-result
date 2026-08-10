import { Fragment } from "react";

import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV2 } from "@/shared/api/seriesAnalysis";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";
import { rankBackgroundColor, rankBorderColor } from "@/shared/ui/rank/rankPresentation";

export function RankTrendCharts({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  const seriesIdentity = response.players.map((player) => ({
    id: player.memberId,
    label: player.displayName,
  }));
  return (
    <div className="grid gap-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">累積平均順位</h3>
        <DataVizLineChart
          ariaLabel="4人の累積平均順位の推移"
          domain={[1, 4]}
          focusItemIds={focusedItemIds}
          formatValue={(value) => `${formatDecimal(value)}位`}
          lowValueAtTop
          minimumYStep={0.5}
          series={trendSeries(response, "rank_cumulative_average")}
          seriesIdentity={seriesIdentity}
          yAxisLabel="平均順位"
          yTicks={[1, 2, 3, 4]}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">順位のぶれ</h3>
        <DataVizLineChart
          ariaLabel="4人の順位のぶれの推移"
          focusItemIds={focusedItemIds}
          formatValue={formatDecimal}
          minimumYStep={0.25}
          series={trendSeries(response, "rank_cumulative_standard_deviation")}
          seriesIdentity={seriesIdentity}
          yAxisLabel="標準偏差"
        />
      </div>
    </div>
  );
}

export function CumulativeFormCharts({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  const seriesIdentity = response.players.map((player) => ({
    id: player.memberId,
    label: player.displayName,
  }));
  return (
    <div className="grid gap-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">累積入賞率</h3>
        <DataVizLineChart
          ariaLabel="4人の累積入賞率の推移"
          domain={[0, 1]}
          focusItemIds={focusedItemIds}
          formatValue={formatPercent}
          minimumYStep={0.25}
          series={trendSeries(response, "podium_cumulative_rate")}
          seriesIdentity={seriesIdentity}
          yAxisLabel="入賞率"
          yTicks={[0, 0.25, 0.5, 0.75, 1]}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">累積下位率</h3>
        <DataVizLineChart
          ariaLabel="4人の累積下位率の推移"
          domain={[0, 1]}
          focusItemIds={focusedItemIds}
          formatValue={formatPercent}
          minimumYStep={0.25}
          series={trendSeries(response, "lower_half_cumulative_rate")}
          seriesIdentity={seriesIdentity}
          yAxisLabel="下位率"
          yTicks={[0, 0.25, 0.5, 0.75, 1]}
        />
      </div>
    </div>
  );
}

export function GinjiCumulativeChart({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  return (
    <DataVizLineChart
      ariaLabel="4人のスリの銀次累計回数の推移"
      focusItemIds={focusedItemIds}
      formatValue={(value) => `${formatDecimal(value)}回`}
      minimumYStep={1}
      series={trendSeries(response, "ginji_cumulative_count")}
      seriesIdentity={response.players.map((player) => ({
        id: player.memberId,
        label: player.displayName,
      }))}
      yAxisLabel="累計回数"
    />
  );
}

export function MomentumMatrices({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {response.momentumSwitch.map((entry, index) => (
        <article
          className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
          key={entry.memberId}
        >
          <h3
            className="mb-3 font-semibold"
            style={{
              borderLeftColor: dataVizSeriesColor(index),
              borderLeftWidth: 3,
              paddingLeft: 8,
            }}
          >
            {entry.displayName}
          </h3>
          <div className="overflow-x-auto pb-1">
            <div className="grid min-w-[24rem] grid-cols-[4rem_repeat(4,minmax(4rem,1fr))] gap-1">
              <div aria-hidden="true" />
              {[1, 2, 3, 4].map((rank) => (
                <div
                  className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-center text-[11px] font-semibold"
                  key={rank}
                  style={{ borderTopColor: rankBorderColor(rank), borderTopWidth: 3 }}
                >
                  次{rank}位
                </div>
              ))}
              {entry.cells.map((cell) => {
                const focused = focusedItemIds.includes(cell.itemId);
                return (
                  <Fragment key={cell.itemId}>
                    {cell.nextRank === 1 ? (
                      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-[11px] font-semibold">
                        前{cell.previousRank}位
                      </div>
                    ) : null}
                    <div
                      aria-label={`${cell.previousRank}位から${cell.nextRank}位、${cell.count}戦、${formatPercent(cell.rate)}${focused ? "、この試合" : ""}`}
                      className={`rounded-[var(--radius-xs)] border px-1 py-2 text-center ${focused ? "momo-enter ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface-subtle)]" : ""}`}
                      data-focused-metric={focused ? "true" : undefined}
                      role="img"
                      style={
                        cell.count === 0
                          ? {
                              backgroundColor: "var(--color-surface)",
                              borderColor: "var(--color-border)",
                            }
                          : {
                              backgroundColor: rankBackgroundColor(cell.nextRank, cell.rate ?? 0),
                              borderColor: rankBorderColor(cell.nextRank),
                            }
                      }
                    >
                      <strong className="text-sm tabular-nums">{cell.count}</strong>
                      <p className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">
                        {formatPercent(cell.rate)}
                      </p>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function trendSeries(response: SeriesComparisonAggregateV2, kind: string) {
  return response.trends
    .filter((series) => series.kind === kind)
    .map((series) => ({
      id: series.memberId,
      points: series.points.map((point) => ({
        index: point.index,
        itemId: point.itemId,
        value: point.value,
      })),
    }));
}
