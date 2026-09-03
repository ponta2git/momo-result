import {
  AnalysisMatrix,
  MatrixAxisHeader,
  MatrixCell,
  MatrixColumnHeader,
  MatrixRowHeader,
  MatrixValueLegend,
  SERIES_RANKS,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import { MomentumRateSummary } from "@/features/seriesComparison/charts/SeriesAnalysisMomentumRateSummary";
import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { DataVizLineChart } from "@/shared/ui/dataViz/LineChart";
import { rankBackgroundColor, rankBorderColor } from "@/shared/ui/rank/rankPresentation";

export function RankTrendCharts({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
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
          formatIndex={formatSeriesMatchIndex}
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
          formatIndex={formatSeriesMatchIndex}
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
  response: SeriesComparisonAggregateV3;
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
          formatIndex={formatSeriesMatchIndex}
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
          formatIndex={formatSeriesMatchIndex}
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
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <DataVizLineChart
      ariaLabel="4人のスリの銀次累計回数の推移"
      focusItemIds={focusedItemIds}
      formatIndex={formatSeriesMatchIndex}
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
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <div className="grid gap-2">
      <MatrixValueLegend
        ariaLabel="順位の切り替わりのセルの読み方"
        items={[
          { id: "count", label: "上段", value: "試合数" },
          {
            id: "rate",
            label: "下段",
            value: "同じ前戦順位から、その次戦順位になった割合",
          },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {response.momentumSwitch.map((entry) => {
          const cellByRanks = new Map(
            entry.cells.map((cell) => [`${cell.previousRank}:${cell.nextRank}`, cell]),
          );
          return (
            <article
              className="min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
              key={entry.memberId}
            >
              <h3 className="mb-3 font-semibold">
                <MemberSequenceLabel memberId={entry.memberId}>
                  {entry.displayName}
                </MemberSequenceLabel>
              </h3>
              <dl className="mb-3 grid gap-2 text-xs sm:grid-cols-3">
                <MomentumRateSummary label="下位の次に入賞" rate={entry.afterLower} />
                <MomentumRateSummary label="4位の次に入賞" rate={entry.afterFourth} />
                <MomentumRateSummary label="入賞の次に下位" rate={entry.afterPodium} />
              </dl>
              <AnalysisMatrix
                ariaLabel={`${entry.displayName}の順位の切り替わり`}
                className="min-w-[24rem] table-fixed"
              >
                <thead>
                  <tr>
                    <MatrixAxisHeader className="w-16 px-1" columnLabel="次戦" rowLabel="前戦" />
                    {SERIES_RANKS.map((rank) => (
                      <MatrixColumnHeader
                        className="px-1 py-1 text-xs"
                        key={rank}
                        style={{ borderTopColor: rankBorderColor(rank), borderTopWidth: 3 }}
                      >
                        次{rank}位
                      </MatrixColumnHeader>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SERIES_RANKS.map((previousRank) => (
                    <tr key={previousRank}>
                      <MatrixRowHeader className="px-1 text-xs">前{previousRank}位</MatrixRowHeader>
                      {SERIES_RANKS.map((nextRank) => {
                        const cell = cellByRanks.get(`${previousRank}:${nextRank}`);
                        if (!cell) {
                          return (
                            <MatrixCell
                              aria-label={`${previousRank}位から${nextRank}位、対象なし`}
                              className="rounded-xs border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-center"
                              key={nextRank}
                            >
                              —
                            </MatrixCell>
                          );
                        }
                        const focused = focusedItemIds.includes(cell.itemId);
                        return (
                          <MatrixCell
                            aria-label={`${cell.previousRank}位から${cell.nextRank}位、${cell.count}戦、${formatPercent(cell.rate)}${focused ? "、この試合" : ""}`}
                            className={`rounded-xs border px-1 py-2 text-center ${focused ? "ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface)]" : ""}`}
                            data-focused-metric={focused ? "true" : undefined}
                            key={nextRank}
                            style={
                              cell.count === 0
                                ? {
                                    backgroundColor: "var(--color-surface)",
                                    borderColor: "var(--color-border)",
                                  }
                                : {
                                    backgroundColor: rankBackgroundColor(
                                      cell.nextRank,
                                      cell.rate ?? 0,
                                    ),
                                    borderColor: rankBorderColor(cell.nextRank),
                                  }
                            }
                          >
                            <strong className="text-sm tabular-nums">{cell.count}</strong>
                            <p className="text-xs text-[var(--color-text-primary)] tabular-nums">
                              {formatPercent(cell.rate)}
                            </p>
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

function trendSeries(response: SeriesComparisonAggregateV3, kind: string) {
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
