import { niceCeil, numberTicks } from "@/shared/ui/dataViz/scales";
import { dataVizSeriesPresentation } from "@/shared/ui/dataViz/seriesPresentation";
import type { DataVizSeriesIdentity } from "@/shared/ui/dataViz/seriesPresentation";

export function DataVizHistogramChart({
  ariaLabel,
  bins,
  series,
  seriesIdentity,
}: {
  ariaLabel: string;
  bins: Array<{ id: number; label: string }>;
  series: Array<{ counts: number[]; id: string }>;
  seriesIdentity: DataVizSeriesIdentity[];
}) {
  const maximum = Math.max(1, ...series.flatMap((item) => item.counts));
  const countCeil = niceCeil(maximum, 1);
  const countsById = new Map(series.map((item) => [item.id, item.counts]));
  return (
    <figure aria-label={ariaLabel} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {seriesIdentity.map((identity) => (
          <SingleHistogram
            bins={bins}
            color={dataVizSeriesPresentation(identity.id).color}
            countCeil={countCeil}
            counts={countsById.get(identity.id) ?? []}
            identity={identity}
            key={identity.id}
          />
        ))}
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        4人とも同じ金額帯と件数目盛りで比較しています。
      </p>
    </figure>
  );
}

function SingleHistogram({
  bins,
  color,
  countCeil,
  counts,
  identity,
}: {
  bins: Array<{ id: number; label: string }>;
  color: string;
  countCeil: number;
  counts: number[];
  identity: DataVizSeriesIdentity;
}) {
  const width = 320;
  const height = 236;
  const padding = { bottom: 72, left: 36, right: 16, top: 18 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const binWidth = chartWidth / Math.max(1, bins.length);
  const barWidth = Math.max(10, binWidth * 0.62);
  return (
    <div className="min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 break-words">{identity.label}</span>
      </div>
      <svg
        aria-label={`${identity.label}の分布`}
        className="w-full rounded-sm bg-[var(--color-surface)]"
        role="img"
        style={{ aspectRatio: `${width} / ${height}` }}
        viewBox={`0 0 ${width} ${height}`}
      >
        {numberTicks(0, countCeil, 5, 1).map((tick) => {
          const y = height - padding.bottom - (tick / countCeil) * chartHeight;
          return (
            <g key={tick}>
              <line
                stroke="var(--color-border)"
                strokeDasharray={tick === 0 ? undefined : "4 4"}
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="12"
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
          const count = counts[binIndex] ?? 0;
          const barHeight = (count / countCeil) * chartHeight;
          const center = padding.left + binIndex * binWidth + binWidth / 2;
          return (
            <g key={bin.id}>
              <rect
                fill={color}
                height={barHeight}
                rx="2"
                width={barWidth}
                x={center - barWidth / 2}
                y={height - padding.bottom - barHeight}
              >
                <title>{`${bin.label}、${count}戦`}</title>
              </rect>
              <text
                fill="var(--color-text-secondary)"
                fontSize="12"
                textAnchor="end"
                transform={`rotate(-30 ${center} ${height - 48})`}
                x={center}
                y={height - 48}
              >
                {bin.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
