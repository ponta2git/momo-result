import type { CSSProperties } from "react";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type TrendSeries = NonNullable<SeriesComparisonResponse["trends"]["rankCumulativeAverage"]>[number];
type Histogram = SeriesComparisonResponse["histograms"]["assets"];

const palette = ["#2f6f9f", "#a45a44", "#4da66d", "#8c7651", "#6f7d74", "#7b5aa6"];

export function playerColor(index: number): string {
  return palette[index % palette.length] ?? "#2f6f9f";
}

export function PlayerLegend({ players }: { players: Player[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {players.map((player, index) => (
        <span key={player.memberId} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: playerColor(index) }}
          />
          {player.displayName}
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  className,
  domain,
  formatValue,
  players,
  series,
}: {
  className?: string;
  domain?: [number, number];
  formatValue: (value: number) => string;
  players: Player[];
  series: TrendSeries[];
}) {
  const width = 720;
  const height = 220;
  const padding = { bottom: 34, left: 42, right: 18, top: 18 };
  const values = series.flatMap((item) =>
    (item.points ?? []).flatMap((point) => (point.value === undefined ? [] : [point.value])),
  );
  const maxIndex = Math.max(
    1,
    ...series.flatMap((item) => (item.points ?? []).map((point) => point.index)),
  );
  const minValue = domain?.[0] ?? Math.min(...values, 0);
  const maxValue = domain?.[1] ?? Math.max(...values, 1);
  const ySpan = maxValue === minValue ? 1 : maxValue - minValue;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));
  const x = (index: number) =>
    padding.left + ((index - 1) / Math.max(1, maxIndex - 1)) * chartWidth;
  const y = (value: number) => padding.top + (1 - (value - minValue) / ySpan) * chartHeight;

  return (
    <figure className={cn("grid gap-2", className)}>
      <svg
        aria-label="推移グラフ"
        className="h-56 w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)]"
        role="img"
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
        {[minValue, maxValue].map((value) => (
          <text
            key={value}
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="end"
            x={padding.left - 8}
            y={y(value) + 4}
          >
            {formatValue(value)}
          </text>
        ))}
        {series.map((item) => {
          const points = (item.points ?? []).filter((point) => point.value !== undefined);
          const path = points
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value ?? 0)}`,
            )
            .join(" ");
          const color = playerColor(playerIndex.get(item.memberId) ?? 0);
          return (
            <g key={item.memberId}>
              <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="3" />
              {points.map((point) => (
                <circle
                  key={`${item.memberId}-${point.index}`}
                  cx={x(point.index)}
                  cy={y(point.value ?? 0)}
                  fill={color}
                  r="3.5"
                />
              ))}
            </g>
          );
        })}
        <text fill="var(--color-text-secondary)" fontSize="12" x={padding.left} y={height - 8}>
          1
        </text>
        <text
          fill="var(--color-text-secondary)"
          fontSize="12"
          textAnchor="end"
          x={width - padding.right}
          y={height - 8}
        >
          {maxIndex}戦
        </text>
      </svg>
      <PlayerLegend players={players} />
    </figure>
  );
}

export function HistogramChart({
  className,
  histogram,
  players,
}: {
  className?: string;
  histogram: Histogram;
  players: Player[];
}) {
  const width = 720;
  const height = 220;
  const padding = { bottom: 44, left: 34, right: 18, top: 18 };
  const bins = histogram.bins ?? [];
  const series = histogram.series ?? [];
  const maxValue = Math.max(1, ...series.flatMap((item) => item.counts ?? []));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const binWidth = chartWidth / Math.max(1, bins.length);
  const barWidth = Math.max(4, (binWidth - 10) / Math.max(1, players.length));
  const playerIndex = new Map(players.map((player, index) => [player.memberId, index]));

  return (
    <figure className={cn("grid gap-2", className)}>
      <svg
        aria-label="ヒストグラム"
        className="h-56 w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface-subtle)]"
        role="img"
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
        {bins.map((bin, binIndex) => {
          const xBase = padding.left + binIndex * binWidth + 5;
          return (
            <g key={bin.index}>
              {series.map((item) => {
                const index = playerIndex.get(item.memberId) ?? 0;
                const value = item.counts?.[binIndex] ?? 0;
                const barHeight = (value / maxValue) * chartHeight;
                return (
                  <rect
                    key={`${item.memberId}-${bin.index}`}
                    fill={playerColor(index)}
                    height={barHeight}
                    rx="2"
                    width={barWidth}
                    x={xBase + index * barWidth}
                    y={height - padding.bottom - barHeight}
                  />
                );
              })}
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="middle"
                x={padding.left + binIndex * binWidth + binWidth / 2}
                y={height - 15}
              >
                {bin.label}
              </text>
            </g>
          );
        })}
        <text
          fill="var(--color-text-secondary)"
          fontSize="12"
          textAnchor="end"
          x={padding.left - 8}
          y={padding.top + 4}
        >
          {maxValue}
        </text>
      </svg>
      <PlayerLegend players={players} />
    </figure>
  );
}

export function playerGridStyle(playerCount: number): CSSProperties {
  return { "--player-count": String(Math.max(1, playerCount)) } as CSSProperties;
}
