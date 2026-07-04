import { motion } from "motion/react";

import { PlayerLegend } from "@/features/seriesComparison/SeriesComparisonChartLegend";
import { buildNumberTicks, formatCompactManYen, niceCeil } from "@/features/seriesComparison/SeriesComparisonChartScales";
import type { MatchPlayerPoint, Player } from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import { formatPercent } from "@/features/seriesComparison/seriesComparisonPresentation";
import { momoTransition } from "@/shared/ui/motion/variants";

export function StrategyScatterPlot({
  players,
  points,
}: {
  players: Player[];
  points: MatchPlayerPoint[];
}) {
  const width = 760;
  const height = 330;
  const padding = { bottom: 64, left: 68, right: 24, top: 22 };
  const plottedPoints = points.filter(
    (point) => isFiniteNumber(point.revenueAssetRate) && isFiniteNumber(point.totalAssets),
  );
  const valuesX = plottedPoints.map((point) => point.revenueAssetRate).filter(isFiniteNumber);
  const valuesY = plottedPoints.map((point) => point.totalAssets).filter(isFiniteNumber);
  const minX = 0;
  const maxX = valuesX.length === 0 ? 1 : niceCeil(Math.max(0.1, ...valuesX), 0.05);
  const minY = valuesY.length === 0 ? 0 : Math.min(0, ...valuesY);
  const maxY = valuesY.length === 0 ? 1 : niceCeil(Math.max(...valuesY), 1);
  const xSpan = Math.max(0.0001, maxX - minX);
  const ySpan = Math.max(1, maxY - minY);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const playerName = new Map(players.map((player) => [player.memberId, player.displayName]));
  const x = (value: number) => padding.left + ((value - minX) / xSpan) * chartWidth;
  const y = (value: number) => padding.top + (1 - (value - minY) / ySpan) * chartHeight;
  const xTicks = buildNumberTicks(minX, maxX, 5, 0.05);
  const yTicks = buildNumberTicks(minY, maxY, 5, 1);

  return (
    <figure className="grid gap-2">
      <div className="flex overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label="物件収益比率と総資産の散布図"
          className="w-[760px] max-w-none shrink-0 overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
          role="img"
          style={{ aspectRatio: `${width} / ${height}` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-border-strong)"
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border)"
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          {xTicks.map((tick) => (
            <g key={`x-${tick}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                x1={x(tick)}
                x2={x(tick)}
                y1={padding.top}
                y2={height - padding.bottom}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="middle"
                x={x(tick)}
                y={height - 28}
              >
                {formatPercent(tick)}
              </text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y(tick) + 4}
              >
                {formatCompactManYen(tick)}
              </text>
            </g>
          ))}
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="end"
            x={width - padding.right}
            y={height - 8}
          >
            物件収益÷総資産
          </text>
          <text fill="var(--color-text-secondary)" fontSize="12" x={8} y={padding.top + 2}>
            総資産
          </text>
          {plottedPoints.map((point) => {
            const color = playerColor(playerIndex.get(point.memberId) ?? 0);
            return (
              <motion.circle
                key={`${point.matchId}-${point.memberId}`}
                animate={{ opacity: 0.78, scale: 1 }}
                cx={x(point.revenueAssetRate ?? 0)}
                cy={y(point.totalAssets)}
                fill={color}
                initial={{ opacity: 0, scale: 0.7 }}
                r="4"
                transition={momoTransition}
              >
                <title>
                  {`${playerName.get(point.memberId) ?? point.memberId}、${point.matchIndex}戦目、物件収益比率 ${formatPercent(point.revenueAssetRate)}、総資産 ${formatCompactManYen(point.totalAssets)}、${point.rank}位`}
                </title>
              </motion.circle>
            );
          })}
        </svg>
      </div>
      <p className="text-center text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
        左ほど遊戯王型（カード重視）、右ほど桃鉄型（物件重視）です。
      </p>
      <PlayerLegend players={players} />
    </figure>
  );
}
