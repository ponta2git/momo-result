import type { ComponentProps } from "react";

import { DataVizLineChart } from "@/features/seriesComparison/charts/dataViz/LineChart";
import { MatrixValueLegend } from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import { MomentumRateSummary } from "@/features/seriesComparison/charts/SeriesAnalysisMomentumRateSummary";
import { RankTransitionMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisRankTransitionMatrix";
import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type TrendChart = Pick<
  ComponentProps<typeof DataVizLineChart>,
  | "ariaLabel"
  | "domain"
  | "formatValue"
  | "lowValueAtTop"
  | "minimumYStep"
  | "yAxisLabel"
  | "yTicks"
> & { kind: SeriesComparisonAggregate["trends"][number]["kind"]; title?: string };

const trendCharts: Record<"rank" | "form" | "ginji", TrendChart[]> = {
  rank: [
    {
      kind: "rank_cumulative_average",
      title: "累積平均順位",
      ariaLabel: "4人の累積平均順位の推移",
      domain: [1, 4],
      formatValue: (value) => `${formatDecimal(value)}位`,
      lowValueAtTop: true,
      minimumYStep: 0.5,
      yAxisLabel: "平均順位",
      yTicks: [1, 2, 3, 4],
    },
    {
      kind: "rank_cumulative_standard_deviation",
      title: "順位のぶれ",
      ariaLabel: "4人の順位のぶれの推移",
      formatValue: formatDecimal,
      minimumYStep: 0.25,
      yAxisLabel: "標準偏差",
    },
  ],
  form: [
    {
      kind: "podium_cumulative_rate",
      title: "累積入賞率",
      ariaLabel: "4人の累積入賞率の推移",
      domain: [0, 1],
      formatValue: formatPercent,
      minimumYStep: 0.25,
      yAxisLabel: "入賞率",
      yTicks: [0, 0.25, 0.5, 0.75, 1],
    },
    {
      kind: "lower_half_cumulative_rate",
      title: "累積下位率",
      ariaLabel: "4人の累積下位率の推移",
      domain: [0, 1],
      formatValue: formatPercent,
      minimumYStep: 0.25,
      yAxisLabel: "下位率",
      yTicks: [0, 0.25, 0.5, 0.75, 1],
    },
  ],
  ginji: [
    {
      kind: "ginji_cumulative_count",
      ariaLabel: "4人のスリの銀次累計回数の推移",
      formatValue: (value) => `${formatDecimal(value)}回`,
      minimumYStep: 1,
      yAxisLabel: "累計回数",
    },
  ],
};

export function SeriesTrendCharts({
  focusedItemIds,
  players,
  trends,
  variant,
}: {
  focusedItemIds: readonly string[];
  players: SeriesComparisonAggregate["players"];
  trends: SeriesComparisonAggregate["trends"];
  variant: keyof typeof trendCharts;
}) {
  const seriesIdentity = players.map((player) => ({
    id: player.memberId,
    label: player.displayName,
  }));
  return (
    <div className="grid gap-6">
      {trendCharts[variant].map(({ kind, title, ...chart }) => (
        <div key={kind}>
          {title ? <h3 className={cn(contentText.heading, "mb-2")}>{title}</h3> : null}
          <DataVizLineChart
            {...chart}
            focusItemIds={focusedItemIds}
            formatIndex={formatSeriesMatchIndex}
            series={trends
              .filter((series) => series.kind === kind)
              .map((series) => ({ id: series.memberId, points: series.points }))}
            seriesIdentity={seriesIdentity}
          />
        </div>
      ))}
    </div>
  );
}

export function MomentumMatrices({
  focusedItemIds,
  entries,
}: {
  focusedItemIds: readonly string[];
  entries: SeriesComparisonAggregate["momentumSwitch"];
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
              <dl className="mb-6 grid gap-4 sm:grid-cols-3">
                <MomentumRateSummary label="下位の次に入賞" rate={entry.afterLower} />
                <MomentumRateSummary label="4位の次に入賞" rate={entry.afterFourth} />
                <MomentumRateSummary label="入賞の次に下位" rate={entry.afterPodium} />
              </dl>
              <RankTransitionMatrix
                ariaLabel={`${entry.displayName}の順位の切り替わり`}
                cells={entry.cells}
                focusedItemIds={focusedItemIds}
                kind="momentum"
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}
