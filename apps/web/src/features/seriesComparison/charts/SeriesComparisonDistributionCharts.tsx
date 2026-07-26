import {
  buildNumberTicks,
  formatCompactManYen,
  niceCeil,
} from "@/features/seriesComparison/charts/SeriesComparisonChartScales";
import type {
  Histogram,
  HistogramBin,
  Player,
  RankDistributionBarEntry,
} from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import { rankColor } from "@/features/seriesComparison/charts/SeriesComparisonRankColors";
import { cn } from "@/shared/ui/cn";

function RankLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {[1, 2, 3, 4].map((rank) => (
        <span className="inline-flex items-center gap-1.5" key={rank}>
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: rankColor(rank) }}
          />
          <span className="font-medium text-[var(--color-text-primary)]">{rank}位</span>
        </span>
      ))}
    </div>
  );
}

export function RankDistributionStackedBars({
  entries,
  players,
}: {
  entries: RankDistributionBarEntry[];
  players: Player[];
}) {
  const entryByMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  return (
    <div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <RankLegend />
      <div className="grid gap-2">
        {players.map((player, index) => {
          const entry = entryByMember.get(player.memberId);
          const totalCount = entry?.totalCount ?? 0;
          const segments = entry?.segments ?? [];
          const label =
            totalCount === 0
              ? `${player.displayName}: 対象なし`
              : `${player.displayName}: ${segments
                  .map((segment) => `${segment.rank}位${segment.count}回`)
                  .join("、")}`;
          return (
            <div
              className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)_4.5rem] sm:items-center"
              key={player.memberId}
            >
              <div
                className="text-sm font-semibold break-words text-[var(--color-text-primary)]"
                style={{ borderLeftColor: playerColor(index), borderLeftWidth: 3, paddingLeft: 8 }}
              >
                {player.displayName}
              </div>
              <div
                aria-label={label}
                className="flex h-8 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface)]"
                role="img"
              >
                {totalCount > 0 ? (
                  segments.map((segment) =>
                    segment.count > 0 ? (
                      <span
                        aria-hidden="true"
                        className="min-w-2"
                        key={segment.rank}
                        style={{
                          backgroundColor: rankColor(segment.rank),
                          flexBasis: `${(((segment.rate ?? segment.count / totalCount) || 0) * 100).toFixed(4)}%`,
                          flexGrow: 0,
                          flexShrink: 0,
                        }}
                        title={`${segment.rank}位 ${segment.count}回`}
                      />
                    ) : null,
                  )
                ) : (
                  <span className="grid w-full place-items-center text-xs text-[var(--color-text-muted)]">
                    対象なし
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] tabular-nums sm:text-right">
                {totalCount}戦
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
        4人とも同じ金額区分と件数目盛りで比較しています。
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
  const height = 236;
  const padding = { bottom: 72, left: 36, right: 16, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const binWidth = chartWidth / Math.max(1, bins.length);
  const barWidth = Math.max(10, binWidth * 0.62);
  const countCeil = niceCeil(maxValue, 1);
  const countTicks = buildNumberTicks(0, countCeil, 5, 1);

  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <span
          aria-hidden="true"
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 break-words">{player.displayName}</span>
      </div>
      <svg
        aria-label={`${player.displayName}のヒストグラム`}
        className="w-full rounded-[var(--radius-sm)] bg-[var(--color-surface)]"
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
        {countTicks.map((tick) => {
          const y = height - padding.bottom - (tick / countCeil) * chartHeight;
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
          const barHeight = (value / countCeil) * chartHeight;
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
                transform={`rotate(-30 ${padding.left + binIndex * binWidth + binWidth / 2} ${height - 48})`}
                x={padding.left + binIndex * binWidth + binWidth / 2}
                y={height - 48}
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
  if (bin.upperExclusive === bin.lowerInclusive + 1) {
    return lower;
  }
  return `${lower}〜${formatCompactManYen(bin.upperExclusive - 1)}`;
}
