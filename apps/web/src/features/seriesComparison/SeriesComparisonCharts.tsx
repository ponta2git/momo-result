import type { CSSProperties } from "react";

import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

type Player = NonNullable<SeriesComparisonResponse["players"]>[number];
type TrendSeries = NonNullable<SeriesComparisonResponse["trends"]["rankCumulativeAverage"]>[number];
type Histogram = SeriesComparisonResponse["histograms"]["assets"];
type HistogramBin = NonNullable<Histogram["bins"]>[number];

const palette = ["#2563eb", "#dc2626", "#d9a300", "#16a34a", "#6f7d74", "#7b5aa6"];

export function playerColor(index: number): string {
  return palette[index % palette.length] ?? "#2563eb";
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
          <span className="font-medium text-[var(--color-text-primary)]">{player.displayName}</span>
        </span>
      ))}
    </div>
  );
}

export function LineChart({
  className,
  domain,
  formatValue,
  lowValueAtTop = false,
  players,
  series,
  yTicks,
}: {
  className?: string;
  domain?: [number, number];
  formatValue: (value: number) => string;
  lowValueAtTop?: boolean;
  players: Player[];
  series: TrendSeries[];
  yTicks?: number[];
}) {
  const width = 760;
  const height = 300;
  const padding = { bottom: 42, left: 54, right: 24, top: 24 };
  const values = series.flatMap((item) =>
    (item.points ?? []).flatMap((point) => (typeof point.value === "number" ? [point.value] : [])),
  );
  const maxIndex = Math.max(
    1,
    ...series.flatMap((item) => (item.points ?? []).map((point) => point.index)),
  );
  const minValue = domain?.[0] ?? 0;
  const maxValue = domain?.[1] ?? niceCeil(Math.max(...values, 1));
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
  const ticks = yTicks ?? buildNumberTicks(minValue, maxValue, 5);

  return (
    <figure className={cn("grid gap-2", className)}>
      <svg
        aria-label="推移グラフ"
        className="h-80 w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)]"
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
        {series.map((item) => {
          const points = (item.points ?? []).flatMap((point) =>
            typeof point.value === "number" ? [{ index: point.index, value: point.value }] : [],
          );
          const path = points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`)
            .join(" ");
          const color = playerColor(playerIndex.get(item.memberId) ?? 0);
          return (
            <g key={item.memberId}>
              <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
              {points.length <= 32
                ? points.map((point) => (
                    <circle
                      key={`${item.memberId}-${point.index}`}
                      cx={x(point.index)}
                      cy={y(point.value)}
                      fill={color}
                      r="2.4"
                    />
                  ))
                : null}
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
  const bins = histogram.bins ?? [];
  const series = histogram.series ?? [];
  const maxValue = Math.max(1, ...series.flatMap((item) => item.counts ?? []));
  const seriesByMember = new Map(series.map((item) => [item.memberId, item.counts ?? []]));

  return (
    <figure className={cn("grid gap-3", className)}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => (
          <SingleHistogram
            key={player.memberId}
            bins={bins}
            color={playerColor(index)}
            counts={seriesByMember.get(player.memberId) ?? []}
            maxValue={maxValue}
            player={player}
          />
        ))}
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        ビン幅と縦軸は全員共通です。
      </p>
    </figure>
  );
}

function SingleHistogram({
  bins,
  color,
  counts,
  maxValue,
  player,
}: {
  bins: HistogramBin[];
  color: string;
  counts: number[];
  maxValue: number;
  player: Player;
}) {
  const width = 320;
  const height = 220;
  const padding = { bottom: 56, left: 36, right: 16, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const binWidth = chartWidth / Math.max(1, bins.length);
  const barWidth = Math.max(10, binWidth * 0.62);
  const countTicks = buildNumberTicks(0, niceCeil(maxValue), 5);

  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{player.displayName}</span>
      </div>
      <svg
        aria-label={`${player.displayName}のヒストグラム`}
        className="h-52 w-full overflow-visible rounded-[var(--radius-sm)] bg-[var(--color-surface)]"
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
        {countTicks.map((tick) => {
          const y = height - padding.bottom - (tick / niceCeil(maxValue)) * chartHeight;
          return (
            <g key={tick}>
              <line
                stroke="var(--color-border)"
                strokeDasharray={tick === 0 ? undefined : "4 4"}
                strokeWidth="0.8"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y + 4}
              >
                {tick}
              </text>
            </g>
          );
        })}
        {bins.map((bin, binIndex) => {
          const value = counts[binIndex] ?? 0;
          const barHeight = (value / niceCeil(maxValue)) * chartHeight;
          return (
            <g key={bin.index}>
              <rect
                fill={color}
                height={barHeight}
                rx="2"
                width={barWidth}
                x={padding.left + binIndex * binWidth + (binWidth - barWidth) / 2}
                y={height - padding.bottom - barHeight}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="10"
                textAnchor="end"
                transform={`rotate(-30 ${padding.left + binIndex * binWidth + binWidth / 2} ${height - 16})`}
                x={padding.left + binIndex * binWidth + binWidth / 2}
                y={height - 16}
              >
                {formatHistogramBinLabel(bin)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function formatHistogramBinLabel(bin: HistogramBin): string {
  const lower = formatCompactManYen(bin.lowerInclusive ?? 0);
  if (bin.upperExclusive == null) {
    return `${lower}+`;
  }
  return `${lower}〜${formatCompactManYen(bin.upperExclusive)}`;
}

function formatCompactManYen(value: number): string {
  if (value === 0) {
    return "0";
  }
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return `${sign}${formatCompactNumber(abs / 10000)}億`;
  }
  return `${value}万`;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function buildNumberTicks(minValue: number, maxValue: number, maxTickCount: number): number[] {
  const span = Math.max(1, maxValue - minValue);
  const rawStep = span / Math.max(1, maxTickCount - 1);
  const step = niceStep(rawStep);
  const first = Math.ceil(minValue / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= maxValue + step * 0.001; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  if (!ticks.includes(minValue)) {
    ticks.unshift(minValue);
  }
  if (!ticks.includes(maxValue)) {
    ticks.push(maxValue);
  }
  return Array.from(new Set(ticks)).toSorted((a, b) => a - b);
}

function niceCeil(value: number): number {
  const step = niceStep(value / 4);
  return Math.max(step, Math.ceil(value / step) * step);
}

function niceStep(rawStep: number): number {
  const safeStep = Math.max(rawStep, 1);
  const magnitude = 10 ** Math.floor(Math.log10(safeStep));
  const normalized = safeStep / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function playerGridStyle(playerCount: number): CSSProperties {
  return { "--player-count": String(Math.max(1, playerCount)) } as CSSProperties;
}
