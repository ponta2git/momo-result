import { motion } from "motion/react";

import { PlayerLegend } from "@/features/seriesComparison/charts/SeriesComparisonChartLegend";
import {
  buildIndexTicks,
  buildNumberTicks,
  niceCeil,
} from "@/features/seriesComparison/charts/SeriesComparisonChartScales";
import type {
  Player,
  TrendSeries,
} from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import { cn } from "@/shared/ui/cn";
import { momoPanelTransition, momoTransition } from "@/shared/ui/motion/variants";

export function LineChart({
  className,
  ariaLabel,
  domain,
  formatValue,
  lowValueAtTop = false,
  minYStep = 1,
  players,
  series,
  yTicks,
}: {
  className?: string;
  ariaLabel: string;
  domain?: [number, number];
  formatValue: (value: number) => string;
  lowValueAtTop?: boolean;
  minYStep?: number;
  players: Player[];
  series: TrendSeries[];
  yTicks?: number[];
}) {
  const width = 760;
  const height = 300;
  const padding = { bottom: 42, left: 54, right: 24, top: 24 };
  const values = series.flatMap((item) =>
    (item.points ?? []).flatMap((point) => (isFiniteNumber(point.value) ? [point.value] : [])),
  );
  const maxIndex = Math.max(
    1,
    ...series.flatMap((item) => (item.points ?? []).map((point) => point.index)),
  );
  const minValue = domain?.[0] ?? 0;
  const observedMaxValue = values.length === 0 ? 1 : Math.max(...values);
  const maxValue =
    domain?.[1] ??
    niceCeil(observedMaxValue <= minValue ? minValue + 1 : observedMaxValue, minYStep);
  const ySpan = maxValue === minValue ? 1 : maxValue - minValue;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const x = (index: number) =>
    padding.left + ((index - 1) / Math.max(1, maxIndex - 1)) * chartWidth;
  const y = (value: number) => {
    const ratio = (value - minValue) / ySpan;
    return padding.top + (lowValueAtTop ? ratio : 1 - ratio) * chartHeight;
  };
  const ticks = yTicks ?? buildNumberTicks(minValue, maxValue, 5, minYStep);
  const xTicks = buildIndexTicks(maxIndex, 6);

  return (
    <figure className={cn("grid gap-2", className)}>
      <div className="flex overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label={ariaLabel}
          className="w-[760px] max-w-none shrink-0 overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
          role="img"
          style={{ aspectRatio: `${width} / ${height}` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-border-strong)"
            strokeWidth="1"
            x1={padding.left}
            x2={width - padding.right}
            y1={height - padding.bottom}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border)"
            strokeWidth="1"
            x1={padding.left}
            x2={padding.left}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          {ticks.map((value) => (
            <g key={value}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                strokeWidth="0.8"
                x1={padding.left}
                x2={width - padding.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="12"
                textAnchor="end"
                x={padding.left - 8}
                y={y(value) + 4}
              >
                {formatValue(value)}
              </text>
            </g>
          ))}
          {xTicks.map((value) => {
            const xPosition = x(value);
            return (
              <g key={value}>
                {value !== 1 && value !== maxIndex ? (
                  <line
                    stroke="var(--color-border)"
                    strokeDasharray="4 4"
                    strokeWidth="0.8"
                    x1={xPosition}
                    x2={xPosition}
                    y1={padding.top}
                    y2={height - padding.bottom}
                  />
                ) : null}
                <text
                  fill="var(--color-text-secondary)"
                  fontSize="12"
                  textAnchor={value === maxIndex ? "end" : value === 1 ? "start" : "middle"}
                  x={xPosition}
                  y={height - 8}
                >
                  {value === maxIndex ? `${value}戦` : value}
                </text>
              </g>
            );
          })}
          {series.map((item) => {
            const points = (item.points ?? []).flatMap((point) =>
              isFiniteNumber(point.value) ? [{ index: point.index, value: point.value }] : [],
            );
            const seriesIndex = playerIndex.get(item.memberId) ?? 0;
            const playerName = players.find(
              (player) => player.memberId === item.memberId,
            )?.displayName;
            const latestPoint = points.reduce<{ index: number; value: number } | null>(
              (latest, point) => (latest === null || point.index > latest.index ? point : latest),
              null,
            );
            const latestLabel =
              latestPoint === null ? "データなし" : `最新 ${formatValue(latestPoint.value)}`;
            const path = points
              .map(
                (point, pointIndex) =>
                  `${pointIndex === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`,
              )
              .join(" ");
            const color = playerColor(seriesIndex);
            return (
              <g key={item.memberId}>
                <title>{`${playerName ?? "社長"}、${latestLabel}`}</title>
                <motion.path
                  animate={{ opacity: 1, pathLength: 1 }}
                  d={path}
                  fill="none"
                  initial={{ opacity: 0.35, pathLength: 0 }}
                  stroke={color}
                  strokeLinecap="round"
                  strokeWidth="1.8"
                  transition={{ ...momoPanelTransition, delay: seriesIndex * 0.035 }}
                />
                {points.length <= 32
                  ? points.map((point) => (
                      <motion.circle
                        key={`${item.memberId}-${point.index}`}
                        animate={{ opacity: 1, scale: 1 }}
                        cx={x(point.index)}
                        cy={y(point.value)}
                        fill={color}
                        initial={{ opacity: 0, scale: 0.65 }}
                        r="2.4"
                        transition={momoTransition}
                      />
                    ))
                  : null}
              </g>
            );
          })}
        </svg>
      </div>
      <PlayerLegend players={players} variant="line" />
    </figure>
  );
}
