import { Fragment } from "react";
import { useLocation } from "react-router-dom";

import {
  formatHistogramManYenBin,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV2 } from "@/shared/api/seriesAnalysis";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { DataVizHistogramChart } from "@/shared/ui/dataViz/HistogramChart";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";
import { DataVizScatterPlot } from "@/shared/ui/dataViz/ScatterPlot";
import { rankBackgroundColor, rankBorderColor } from "@/shared/ui/rank/rankPresentation";

export function AssetRevenueHistograms({ response }: { response: SeriesComparisonAggregateV2 }) {
  const seriesIdentity = response.players.map((player) => ({
    id: player.memberId,
    label: player.displayName,
  }));
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">総資産の分布</h3>
        <DataVizHistogramChart
          ariaLabel="4人の総資産分布"
          bins={response.histograms.assets.bins.map((bin) => ({
            id: bin.index,
            label: formatHistogramManYenBin(bin),
          }))}
          series={response.histograms.assets.series.map((series) => ({
            counts: series.counts,
            id: series.memberId,
          }))}
          seriesIdentity={seriesIdentity}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">物件収益の分布</h3>
        <DataVizHistogramChart
          ariaLabel="4人の物件収益分布"
          bins={response.histograms.revenue.bins.map((bin) => ({
            id: bin.index,
            label: formatHistogramManYenBin(bin),
          }))}
          series={response.histograms.revenue.series.map((series) => ({
            counts: series.counts,
            id: series.memberId,
          }))}
          seriesIdentity={seriesIdentity}
        />
      </div>
    </div>
  );
}

export function RevenueConversionMatrices({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {response.revenueRankConversion.map((entry, playerIndex) => (
        <article
          className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
          key={entry.memberId}
        >
          <h3
            className="mb-3 text-sm font-semibold"
            style={{
              borderLeftColor: dataVizSeriesColor(playerIndex),
              borderLeftWidth: 3,
              paddingLeft: 8,
            }}
          >
            {entry.displayName}
          </h3>
          <div className="overflow-x-auto pb-1">
            <div className="grid min-w-[25rem] grid-cols-[4.5rem_repeat(4,minmax(4.5rem,1fr))] gap-1">
              <div className="grid content-center rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-[9px] font-semibold text-[var(--color-text-secondary)]">
                <span>行: 収益順位</span>
                <span>列: 最終順位</span>
              </div>
              {[1, 2, 3, 4].map((rank) => (
                <div
                  className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-center text-[11px] font-semibold"
                  key={rank}
                  style={{ borderTopColor: rankBorderColor(rank), borderTopWidth: 3 }}
                >
                  最終{rank}位
                </div>
              ))}
              {entry.cells.map((cell) => (
                <Fragment key={cell.itemId}>
                  {cell.finalRank === 1 ? (
                    <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-[11px] font-semibold">
                      収益{cell.revenueRank}位
                    </div>
                  ) : null}
                  <div
                    aria-label={`収益${cell.revenueRank}位から最終${cell.finalRank}位、${cell.count}戦、${formatPercent(cell.rate)}${focusedItemIds.includes(cell.itemId) ? "、この試合" : ""}`}
                    className={`rounded-[var(--radius-xs)] border px-1 py-2 text-center ${focusedItemIds.includes(cell.itemId) ? "momo-enter ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface-subtle)]" : ""}`}
                    data-focused-metric={focusedItemIds.includes(cell.itemId) ? "true" : undefined}
                    role="img"
                    style={
                      cell.count === 0
                        ? {
                            backgroundColor: "var(--color-surface)",
                            borderColor: "var(--color-border)",
                          }
                        : {
                            backgroundColor: rankBackgroundColor(cell.finalRank, cell.rate ?? 0),
                            borderColor: rankBorderColor(cell.finalRank),
                          }
                    }
                  >
                    <strong className="text-sm tabular-nums">{cell.count}</strong>
                    <p className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">
                      {formatPercent(cell.rate)}
                    </p>
                    {focusedItemIds.includes(cell.itemId) ? (
                      <p className="mt-0.5 text-[9px] font-semibold text-[var(--color-action)]">
                        この試合
                      </p>
                    ) : null}
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function StrategyScatter({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
}) {
  const returnTo = currentInternalLocation(useLocation());
  return (
    <DataVizScatterPlot
      ariaLabel="物件収益比率と総資産の散布図"
      focusItemIds={focusedItemIds}
      formatX={formatPercent}
      formatY={formatManYen}
      points={response.strategyScatter.points.flatMap((point) =>
        point.revenueAssetRate === null
          ? []
          : [
              {
                href: withReturnTo(`/matches/${encodeURIComponent(point.matchId)}`, returnTo),
                itemId: point.itemId,
                label: `${point.matchIndex}戦目、${formatPercent(point.revenueAssetRate)}、${formatManYen(point.totalAssetsManYen)}、${point.rank}位`,
                seriesId: point.memberId,
                x: point.revenueAssetRate,
                y: point.totalAssetsManYen,
              },
            ],
      )}
      seriesIdentity={response.players.map((player) => ({
        id: player.memberId,
        label: player.displayName,
      }))}
      xAxisLabel="物件収益÷総資産"
      xMinimumStep={0.05}
      yAxisLabel="総資産"
      yMinimumStep={1}
    />
  );
}
