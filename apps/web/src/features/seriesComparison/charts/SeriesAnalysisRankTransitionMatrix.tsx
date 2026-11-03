import {
  focusedMetricLabelClass,
  focusedMetricRingClass,
} from "@/features/seriesComparison/charts/chartPresentation";
import {
  AnalysisMatrix,
  MatrixAxisHeader,
  MatrixCell,
  MatrixColumnHeader,
  MatrixRowHeader,
  SERIES_RANKS,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import { formatPercent } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { rankBackgroundColor, rankBorderColor } from "@/shared/matches/rankPresentation";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

type RevenueCells = SeriesComparisonAggregate["revenueRankConversion"][number]["cells"];
type MomentumCells = SeriesComparisonAggregate["momentumSwitch"][number]["cells"];
type Transition =
  | { kind: "revenue"; cells: RevenueCells }
  | { kind: "momentum"; cells: MomentumCells };

/** Renders counts and supplied row rates; transition statistics remain artifact-owned. */
export function RankTransitionMatrix({
  ariaLabel,
  focusedItemIds,
  ...transition
}: Transition & { ariaLabel: string; focusedItemIds: readonly string[] }) {
  const revenue = transition.kind === "revenue";
  const cellByRanks = new Map(
    transition.cells.map((cell) => [
      "revenueRank" in cell
        ? `${cell.revenueRank}:${cell.finalRank}`
        : `${cell.previousRank}:${cell.nextRank}`,
      cell,
    ]),
  );
  return (
    <AnalysisMatrix
      ariaLabel={ariaLabel}
      className={revenue ? "min-w-[25rem] table-fixed" : "min-w-[24rem] table-fixed"}
    >
      <thead>
        <tr>
          <MatrixAxisHeader
            className={revenue ? "w-24" : "w-20"}
            columnLabel={revenue ? "最終順位" : "次戦"}
            rowLabel={revenue ? "収益順位" : "前戦"}
          />
          {SERIES_RANKS.map((rank) => (
            <MatrixColumnHeader
              key={rank}
              style={{ borderTopColor: rankBorderColor(rank), borderTopWidth: 3 }}
            >
              {revenue ? "最終" : "次"}
              {rank}位
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {SERIES_RANKS.map((fromRank) => (
          <tr key={fromRank}>
            <MatrixRowHeader>
              {revenue ? "収益" : "前"}
              {fromRank}位
            </MatrixRowHeader>
            {SERIES_RANKS.map((toRank) => {
              const cell = cellByRanks.get(`${fromRank}:${toRank}`);
              const focused = cell !== undefined && focusedItemIds.includes(cell.itemId);
              const label = revenue
                ? `収益${fromRank}位から最終${toRank}位`
                : `${fromRank}位から${toRank}位`;
              return (
                <MatrixCell
                  aria-label={`${label}、${cell ? `${cell.count}戦、${formatPercent(cell.rate)}${focused ? "、この試合" : ""}` : "対象なし"}`}
                  className={cn(
                    "rounded-xs border px-2 py-2 text-center",
                    focused && focusedMetricRingClass,
                  )}
                  data-focused-metric={focused ? "true" : undefined}
                  key={toRank}
                  style={
                    cell && cell.count > 0
                      ? {
                          backgroundColor: rankBackgroundColor(toRank, cell.rate ?? 0),
                          borderColor: rankBorderColor(toRank),
                        }
                      : {
                          backgroundColor: "var(--color-surface)",
                          borderColor: "var(--color-border)",
                        }
                  }
                >
                  {cell ? (
                    <>
                      <strong className={cn(contentText.compactPrimary, "tabular-nums")}>
                        {cell.count}
                      </strong>
                      <p className={cn(contentText.body, "tabular-nums")}>
                        {formatPercent(cell.rate)}
                      </p>
                      {focused ? (
                        <p className={cn(focusedMetricLabelClass, "mt-0.5")}>この試合</p>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </MatrixCell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </AnalysisMatrix>
  );
}
