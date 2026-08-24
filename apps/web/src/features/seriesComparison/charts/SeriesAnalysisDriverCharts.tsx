import { useLocation } from "react-router-dom";

import {
  AnalysisMatrix,
  MatrixAxisHeader,
  MatrixCell,
  MatrixColumnHeader,
  MatrixRowHeader,
  MatrixValueLegend,
  SERIES_RANKS,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatHistogramManYenBin,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { DataVizHistogramChart } from "@/shared/ui/dataViz/HistogramChart";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";
import { DataVizScatterPlot } from "@/shared/ui/dataViz/ScatterPlot";
import { rankBackgroundColor, rankBorderColor } from "@/shared/ui/rank/rankPresentation";

export function AssetRevenueHistograms({ response }: { response: SeriesComparisonAggregateV3 }) {
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
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <div className="grid gap-2">
      <MatrixValueLegend
        ariaLabel="物件収益と最終順位のセルの読み方"
        items={[
          { id: "count", label: "上段", value: "試合数" },
          {
            id: "rate",
            label: "下段",
            value: "同じ物件収益順位の中で、その最終順位になった割合",
          },
        ]}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        {response.revenueRankConversion.map((entry, playerIndex) => {
          const cellByRanks = new Map(
            entry.cells.map((cell) => [`${cell.revenueRank}:${cell.finalRank}`, cell]),
          );
          return (
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
              <AnalysisMatrix
                ariaLabel={`${entry.displayName}の物件収益順位と最終順位`}
                className="min-w-[25rem] table-fixed"
              >
                <thead>
                  <tr>
                    <MatrixAxisHeader
                      className="w-[4.5rem] bg-[var(--color-surface)] px-1"
                      columnLabel="最終順位"
                      rowLabel="収益順位"
                    />
                    {SERIES_RANKS.map((rank) => (
                      <MatrixColumnHeader
                        className="bg-[var(--color-surface)] px-1 py-1 text-[11px]"
                        key={rank}
                        style={{ borderTopColor: rankBorderColor(rank), borderTopWidth: 3 }}
                      >
                        最終{rank}位
                      </MatrixColumnHeader>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SERIES_RANKS.map((revenueRank) => (
                    <tr key={revenueRank}>
                      <MatrixRowHeader className="bg-[var(--color-surface)] px-1 text-[11px]">
                        収益{revenueRank}位
                      </MatrixRowHeader>
                      {SERIES_RANKS.map((finalRank) => {
                        const cell = cellByRanks.get(`${revenueRank}:${finalRank}`);
                        if (!cell) {
                          return (
                            <MatrixCell
                              aria-label={`収益${revenueRank}位から最終${finalRank}位、対象なし`}
                              className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-center"
                              key={finalRank}
                            >
                              —
                            </MatrixCell>
                          );
                        }
                        const focused = focusedItemIds.includes(cell.itemId);
                        return (
                          <MatrixCell
                            aria-label={`収益${cell.revenueRank}位から最終${cell.finalRank}位、${cell.count}戦、${formatPercent(cell.rate)}${focused ? "、この試合" : ""}`}
                            className={`rounded-[var(--radius-xs)] border px-1 py-2 text-center ${focused ? "momo-enter ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface-subtle)]" : ""}`}
                            data-focused-metric={focused ? "true" : undefined}
                            key={finalRank}
                            style={
                              cell.count === 0
                                ? {
                                    backgroundColor: "var(--color-surface)",
                                    borderColor: "var(--color-border)",
                                  }
                                : {
                                    backgroundColor: rankBackgroundColor(
                                      cell.finalRank,
                                      cell.rate ?? 0,
                                    ),
                                    borderColor: rankBorderColor(cell.finalRank),
                                  }
                            }
                          >
                            <strong className="text-sm tabular-nums">{cell.count}</strong>
                            <p className="text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                              {formatPercent(cell.rate)}
                            </p>
                            {focused ? (
                              <p className="mt-0.5 text-[11px] font-semibold text-[var(--color-action)]">
                                この試合
                              </p>
                            ) : null}
                          </MatrixCell>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </AnalysisMatrix>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function StrategyScatter({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
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
