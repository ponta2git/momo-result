import { DataVizLegend, DataVizPointMark } from "@/shared/ui/dataViz/playerSeries";
import type { DataVizSeriesIdentity } from "@/shared/ui/dataViz/playerSeries";
import { finiteNumber } from "@/shared/ui/dataViz/scales";

export function DataVizQuadrantPlot({
  ariaLabel,
  cornerLabels,
  points,
  seriesIdentity,
  xAxisLabel,
  xMidpoint,
  yAxisLabel,
  yDomain,
  yMidpoint,
}: {
  ariaLabel: string;
  cornerLabels: { bottomLeft: string; bottomRight: string; topLeft: string; topRight: string };
  points: Array<{ label: string; seriesId: string; x: number | null; y: number | null }>;
  seriesIdentity: DataVizSeriesIdentity[];
  xAxisLabel: string;
  xMidpoint: number | null;
  yAxisLabel: string;
  yDomain: [number, number];
  yMidpoint: number | null;
}) {
  const width = 620;
  const height = 340;
  const padding = { bottom: 58, left: 66, right: 66, top: 24 };
  const plotted = points.filter(
    (point): point is { label: string; seriesId: string; x: number; y: number } =>
      finiteNumber(point.x) && finiteNumber(point.y),
  );
  const middleX = xMidpoint ?? 0;
  const middleY = yMidpoint ?? (yDomain[0] + yDomain[1]) / 2;
  const xDistances = plotted.map((point) => Math.abs(point.x - middleX));
  const xRadius = Math.max(0.01, ...xDistances);
  const minX = middleX - xRadius;
  const maxX = middleX + xRadius;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const identityIndex = new Map(seriesIdentity.map((item, index) => [item.id, index]));
  const x = (value: number) => padding.left + ((value - minX) / (maxX - minX)) * chartWidth;
  const y = (value: number) =>
    padding.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * chartHeight;

  return (
    <figure className="grid max-w-full min-w-0 gap-2">
      <div className="flex justify-center overflow-x-auto pb-1">
        <svg
          aria-label={ariaLabel}
          className="w-[620px] max-w-none shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface)] sm:max-w-full"
          role="img"
          style={{ aspectRatio: `${width} / ${height}` }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="5 5"
            x1={x(middleX)}
            x2={x(middleX)}
            y1={padding.top}
            y2={height - padding.bottom}
          />
          <line
            stroke="var(--color-border-strong)"
            strokeDasharray="5 5"
            x1={padding.left}
            x2={width - padding.right}
            y1={y(middleY)}
            y2={y(middleY)}
          />
          <CornerLabel x={padding.left + 8} y={padding.top + 16}>
            {cornerLabels.topLeft}
          </CornerLabel>
          <CornerLabel anchor="end" x={width - padding.right - 8} y={padding.top + 16}>
            {cornerLabels.topRight}
          </CornerLabel>
          <CornerLabel x={padding.left + 8} y={height - padding.bottom - 10}>
            {cornerLabels.bottomLeft}
          </CornerLabel>
          <CornerLabel anchor="end" x={width - padding.right - 8} y={height - padding.bottom - 10}>
            {cornerLabels.bottomRight}
          </CornerLabel>
          {plotted.map((point) => (
            <DataVizPointMark
              cx={x(point.x)}
              cy={y(point.y)}
              index={identityIndex.get(point.seriesId) ?? 0}
              key={point.seriesId}
              size={5}
            >
              <title>{point.label}</title>
            </DataVizPointMark>
          ))}
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            x={padding.left + chartWidth / 2}
            y={height - 10}
          >
            {xAxisLabel}
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            transform={`rotate(-90 20 ${padding.top + chartHeight / 2})`}
            x="20"
            y={padding.top + chartHeight / 2}
          >
            {yAxisLabel}
          </text>
        </svg>
      </div>
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        破線は4人の中央値です。近い点は断定せず、同程度として読みます。
      </p>
      <DataVizLegend series={seriesIdentity} />
    </figure>
  );
}

function CornerLabel({
  anchor = "start",
  children,
  x,
  y,
}: {
  anchor?: "end" | "start";
  children: string;
  x: number;
  y: number;
}) {
  return (
    <text fill="var(--color-text-secondary)" fontSize="10.5" textAnchor={anchor} x={x} y={y}>
      {children}
    </text>
  );
}
