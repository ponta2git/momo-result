import type { CSSProperties } from "react";

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
import type { RelativeIntensity, SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { PlayOrderMark } from "@/shared/ui/data/PlayOrderMark";
import { colorMix } from "@/shared/ui/rank/rankPresentation";

const PLAY_ORDERS = [1, 2, 3, 4] as const;

export function PlayOrderMatrix({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <AnalysisMatrix ariaLabel="番手別成績" className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-32" columnLabel="番手" rowLabel="プレーヤー" />
          {PLAY_ORDERS.map((playOrder) => (
            <MatrixColumnHeader key={playOrder}>
              <PlayOrderMark className="justify-center" playOrder={playOrder} />
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {response.playOrderComparison.map((entry) => {
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
                      className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-center"
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
                    className={`rounded-[var(--radius-xs)] border px-2 py-2 text-center ${focused ? "ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface)]" : ""}`}
                    data-focused-metric={focused ? "true" : undefined}
                    key={playOrder}
                    style={presentation.style}
                  >
                    <strong className="text-sm tabular-nums">
                      {formatDecimal(cell.rankAverage)}位
                    </strong>
                    <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                      {cell.targetCount}戦・入賞{formatPercent(cell.podiumRate)}
                    </p>
                    {presentation.label ? (
                      <p
                        className="mt-1 text-[11px] font-semibold"
                        style={{ color: presentation.accentColor }}
                      >
                        {presentation.label}
                      </p>
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
      ? "var(--color-tray-incident)"
      : isBest
        ? "var(--color-analysis-positive)"
        : isWorst
          ? "var(--color-analysis-negative)"
          : "var(--color-tray-incident)";
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
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {response.cardShopDestination.map((entry) => (
        <article
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          key={entry.memberId}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-semibold">
              <MemberSequenceLabel memberId={entry.memberId}>
                {entry.displayName}
              </MemberSequenceLabel>
            </h3>
            <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
              売り場あり {entry.cardShopMatchCount}/{entry.denominator}戦・目的地なし
              {formatPercent(entry.cardShopWithoutDestinationRate)}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {entry.quadrants.map((quadrant) => {
              const focused = focusedItemIds.includes(quadrant.itemId);
              return (
                <div
                  className={`border-l-2 border-[var(--color-border)] px-2 py-1 ${focused ? "ring-2 ring-[var(--color-action)] ring-offset-1 ring-offset-[var(--color-surface)]" : ""}`}
                  data-focused-metric={focused ? "true" : undefined}
                  key={quadrant.itemId}
                >
                  <h4 className="text-xs font-semibold">
                    {cardShopKindLabel(quadrant.kind)}
                    {focused ? "・この試合" : ""}
                  </h4>
                  <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
                    <Value label="対象" value={`${quadrant.targetCount}戦`} />
                    <Value label="平均順位" value={`${formatDecimal(quadrant.averageRank)}位`} />
                    <Value label="勝率" value={formatPercent(quadrant.winRate)} />
                    <Value label="入賞率" value={formatPercent(quadrant.podiumRate)} />
                    <Value label="平均資産" value={formatManYen(quadrant.averageAssets)} />
                    <Value label="平均収益" value={formatManYen(quadrant.averageRevenue)} />
                    <Value label="該当率" value={formatPercent(quadrant.rate)} />
                  </dl>
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
