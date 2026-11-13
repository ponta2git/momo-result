import type { CSSProperties } from "react";

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
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  cardShopKindLabel,
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { RelativeIntensity, SeriesComparisonAggregate } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { PlayOrderMark } from "@/shared/matches/PlayOrderMark";
import { colorMix } from "@/shared/matches/rankPresentation";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

const PLAY_ORDERS = [1, 2, 3, 4] as const;

export function PlayOrderMatrix({
  focusedItemIds,
  entries,
}: {
  focusedItemIds: readonly string[];
  entries: SeriesComparisonAggregate["playOrderComparison"];
}) {
  return (
    <AnalysisMatrix ariaLabel="番手別成績" className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-32" columnLabel="番手" rowLabel="プレーヤー" />
          {PLAY_ORDERS.map((playOrder) => (
            <MatrixColumnHeader key={playOrder}>
              <PlayOrderMark align="center" playOrder={playOrder} />
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const cellByPlayOrder = new Map(entry.cells.map((cell) => [cell.playOrder, cell]));
          return (
            <tr key={entry.memberId}>
              <MatrixRowHeader>
                <MemberSequenceLabel accent={false} memberId={entry.memberId}>
                  {entry.displayName}
                </MemberSequenceLabel>
              </MatrixRowHeader>
              {PLAY_ORDERS.map((playOrder) => {
                const cell = cellByPlayOrder.get(playOrder);
                if (!cell) {
                  return (
                    <MatrixCell
                      aria-label={`${entry.displayName}、${playOrder}番手、対象なし`}
                      className="rounded-xs border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center"
                      key={playOrder}
                    >
                      —
                    </MatrixCell>
                  );
                }
                const focused = focusedItemIds.includes(cell.itemId);
                const presentation = playOrderCellPresentation({
                  bestPlayOrder: entry.bestPlayOrder,
                  playOrder: cell.playOrder,
                  relativeIntensity: cell.relativeIntensity,
                  targetCount: cell.targetCount,
                  worstPlayOrder: entry.worstPlayOrder,
                });
                return (
                  <MatrixCell
                    aria-label={`${entry.displayName}、${cell.playOrder}番手、平均${formatDecimal(cell.rankAverage)}位、${cell.targetCount}戦${presentation.label ? `、${presentation.label}` : ""}${focused ? "、この試合" : ""}`}
                    className={cn(
                      "rounded-xs border px-2 py-2 text-center",
                      focused && focusedMetricRingClass,
                    )}
                    data-focused-metric={focused ? "true" : undefined}
                    key={playOrder}
                    style={presentation.style}
                  >
                    <strong className={cn(contentText.compactPrimary, "tabular-nums")}>
                      {formatDecimal(cell.rankAverage)}位
                    </strong>
                    <p className={cn(contentText.supporting, "mt-0.5 tabular-nums")}>
                      {cell.targetCount}戦・入賞{formatPercent(cell.podiumRate)}
                    </p>
                    {presentation.label ? (
                      <p
                        className={cn(contentText.body, "mt-1")}
                        style={{ color: presentation.accentColor }}
                      >
                        {presentation.label}
                      </p>
                    ) : null}
                    {focused ? (
                      <p className={cn(focusedMetricLabelClass, "mt-0.5")}>この試合</p>
                    ) : null}
                  </MatrixCell>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </AnalysisMatrix>
  );
}

export function playOrderCellPresentation({
  bestPlayOrder,
  playOrder,
  relativeIntensity,
  targetCount,
  worstPlayOrder,
}: {
  bestPlayOrder: number | null;
  playOrder: number;
  relativeIntensity: RelativeIntensity;
  targetCount: number;
  worstPlayOrder: number | null;
}): { accentColor: string; label: string | null; style: CSSProperties } {
  if (targetCount === 0) {
    return {
      accentColor: "var(--color-text-muted)",
      label: null,
      style: {
        backgroundColor: "var(--color-surface)",
        borderColor: "var(--color-border)",
      },
    };
  }

  const isBest = playOrder === bestPlayOrder;
  const isWorst = playOrder === worstPlayOrder;
  const alpha = relativeIntensityAlpha(relativeIntensity);
  const accentColor =
    isBest && isWorst
      ? "var(--color-analysis-neutral)"
      : isBest
        ? "var(--color-analysis-positive)"
        : isWorst
          ? "var(--color-analysis-negative)"
          : "var(--color-analysis-neutral)";
  return {
    accentColor,
    label: isBest && isWorst ? "同等" : isBest ? "得意" : isWorst ? "苦手" : null,
    style: {
      backgroundColor: colorMix(accentColor, alpha),
      borderColor: colorMix(accentColor, alpha + 0.12 < 0.28 ? 0.28 : alpha + 0.12),
    },
  };
}

function relativeIntensityAlpha(intensity: RelativeIntensity): number {
  switch (intensity) {
    case "high":
      return 0.22;
    case "medium":
      return 0.14;
    case "low":
      return 0.08;
    case "none":
      return 0.06;
  }
}

export function CardShopDestinationQuadrants({
  focusedItemIds,
  entries,
}: {
  focusedItemIds: readonly string[];
  entries: SeriesComparisonAggregate["cardShopDestination"];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {entries.map((entry) => (
        <article
          className="grid min-w-0 content-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          key={entry.memberId}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className={contentText.heading}>
              <MemberSequenceLabel memberId={entry.memberId}>
                {entry.displayName}
              </MemberSequenceLabel>
            </h3>
            <span className={cn(contentText.supporting, "tabular-nums")}>
              売り場あり {entry.cardShopMatchCount}/{entry.denominator}戦・目的地なし
              {formatPercent(entry.cardShopWithoutDestinationRate)}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {entry.quadrants.map((quadrant) => {
              const focused = focusedItemIds.includes(quadrant.itemId);
              return (
                <div
                  className={cn(
                    "grid min-w-0 content-start gap-2",
                    focused && focusedMetricRingClass,
                  )}
                  data-focused-metric={focused ? "true" : undefined}
                  key={quadrant.itemId}
                >
                  <h4 className={contentText.heading}>
                    {cardShopKindLabel(quadrant.kind)}
                    {focused ? "・この試合" : ""}
                  </h4>
                  <FactList
                    ariaLabel={`${entry.displayName}の${cardShopKindLabel(quadrant.kind)}`}
                    items={[
                      { id: "target", label: "対象", value: `${quadrant.targetCount}戦` },
                      {
                        id: "average-rank",
                        label: "平均順位",
                        value: `${formatDecimal(quadrant.averageRank)}位`,
                      },
                      { id: "win-rate", label: "勝率", value: formatPercent(quadrant.winRate) },
                      {
                        id: "podium-rate",
                        label: "入賞率",
                        value: formatPercent(quadrant.podiumRate),
                      },
                      {
                        id: "average-assets",
                        label: "平均資産",
                        value: formatManYen(quadrant.averageAssets),
                      },
                      {
                        id: "average-revenue",
                        label: "平均収益",
                        value: formatManYen(quadrant.averageRevenue),
                      },
                      { id: "rate", label: "該当率", value: formatPercent(quadrant.rate) },
                    ]}
                    layout="inline"
                  />
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}
