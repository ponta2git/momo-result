import { useLocation } from "react-router-dom";

import { DataVizHistogramChart } from "@/features/seriesComparison/charts/dataViz/HistogramChart";
import { DataVizScatterPlot } from "@/features/seriesComparison/charts/dataViz/ScatterPlot";
import { MatrixValueLegend } from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import { RankTransitionMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisRankTransitionMatrix";
import {
  formatHistogramManYenBin,
  formatManYen,
  formatPercent,
  playerName,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export function AssetRevenueHistograms({
  players,
  histograms,
}: {
  players: SeriesComparisonAggregate["players"];
  histograms: SeriesComparisonAggregate["histograms"];
}) {
  const seriesIdentity = players.map((player) => ({
    id: player.memberId,
    label: player.displayName,
  }));
  return (
    <div className="grid gap-6">
      {(
        [
          ["assets", "総資産"],
          ["revenue", "物件収益"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <h3 className={cn(contentText.heading, "mb-2")}>{label}の分布</h3>
          <DataVizHistogramChart
            ariaLabel={`4人の${label}分布`}
            bins={histograms[key].bins.map((bin) => ({
              id: bin.index,
              label: formatHistogramManYenBin(bin),
            }))}
            series={histograms[key].series.map((series) => ({
              counts: series.counts,
              id: series.memberId,
            }))}
            seriesIdentity={seriesIdentity}
          />
        </div>
      ))}
    </div>
  );
}

export function RevenueConversionMatrices({
  focusedItemIds,
  entries,
}: {
  focusedItemIds: readonly string[];
  entries: SeriesComparisonAggregate["revenueRankConversion"];
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
      <div className="grid gap-4 lg:grid-cols-2">
        {entries.map((entry) => {
          return (
            <article
              className="min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              key={entry.memberId}
            >
              <h3 className={cn(contentText.heading, "mb-4")}>
                <MemberSequenceLabel memberId={entry.memberId}>
                  {entry.displayName}
                </MemberSequenceLabel>
              </h3>
              <RankTransitionMatrix
                ariaLabel={`${entry.displayName}の物件収益順位と最終順位`}
                cells={entry.cells}
                focusedItemIds={focusedItemIds}
                kind="revenue"
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function StrategyScatter({
  focusedItemIds,
  players,
  points,
}: {
  focusedItemIds: readonly string[];
  players: SeriesComparisonAggregate["players"];
  points: SeriesComparisonAggregate["strategyScatter"]["points"];
}) {
  const returnTo = currentInternalLocation(useLocation());
  return (
    <DataVizScatterPlot
      ariaLabel="物件収益比率と総資産の散布図"
      focusItemIds={focusedItemIds}
      formatX={formatPercent}
      formatY={formatManYen}
      points={points.flatMap((point) =>
        point.revenueAssetRate === null
          ? []
          : [
              {
                href: withReturnTo(`/matches/${encodeURIComponent(point.matchId)}`, returnTo),
                itemId: point.itemId,
                label: `${playerName(players, point.memberId)}、${formatSeriesMatchIndex(point.matchIndex)}、${point.rank}位`,
                seriesId: point.memberId,
                x: point.revenueAssetRate,
                y: point.totalAssetsManYen,
              },
            ],
      )}
      seriesIdentity={players.map((player) => ({
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
