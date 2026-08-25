import { finiteNumber, niceCeil, numberTicks } from "@/shared/ui/dataViz/scales";
import { DataVizLegend, DataVizPointMark } from "@/shared/ui/dataViz/seriesPresentation";
import type { DataVizSeriesIdentity } from "@/shared/ui/dataViz/seriesPresentation";

export type DataVizScatterPoint = {
  href?: string | undefined;
  itemId: string;
  label: string;
  seriesId: string;
  x: number;
  y: number;
};

const emptyFocusItemIds: readonly string[] = [];

export function DataVizScatterPlot({
  ariaLabel,
  focusItemIds = emptyFocusItemIds,
  formatX,
  formatY,
  points,
  seriesIdentity,
  xAxisLabel,
  xDomain,
  xMinimumStep,
  yAxisLabel,
  yDomain,
  yMinimumStep,
}: {
  ariaLabel: string;
  focusItemIds?: readonly string[];
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  points: DataVizScatterPoint[];
  seriesIdentity: DataVizSeriesIdentity[];
  xAxisLabel: string;
  xDomain?: [number, number] | undefined;
  xMinimumStep: number;
  yAxisLabel: string;
  yDomain?: [number, number] | undefined;
  yMinimumStep: number;
}) {
  const width = 760;
  const height = 360;
  const padding = { bottom: 64, left: 92, right: 36, top: 28 };
  const plotted = points.filter((point) => finiteNumber(point.x) && finiteNumber(point.y));
  const xValues = plotted.map((point) => point.x);
  const yValues = plotted.map((point) => point.y);
  const minX = xDomain?.[0] ?? Math.min(0, ...xValues);
  const maxX = xDomain?.[1] ?? niceCeil(Math.max(minX + xMinimumStep, ...xValues), xMinimumStep);
  const minY = yDomain?.[0] ?? Math.min(0, ...yValues);
  const maxY = yDomain?.[1] ?? niceCeil(Math.max(minY + yMinimumStep, ...yValues), yMinimumStep);
  const xSpan = Math.max(xMinimumStep, maxX - minX);
  const ySpan = Math.max(yMinimumStep, maxY - minY);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (value: number) => padding.left + ((value - minX) / xSpan) * chartWidth;
  const y = (value: number) => padding.top + (1 - (value - minY) / ySpan) * chartHeight;

  return (
    <figure className="grid max-w-full min-w-0 gap-2">
      <div className="flex max-w-full min-w-0 overflow-x-auto pb-1 md:justify-center">
        <svg
          aria-label={ariaLabel}
          className="w-[760px] max-w-none shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface)] md:w-full md:max-w-[980px]"
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
          {numberTicks(minX, maxX, 5, xMinimumStep).map((tick) => (
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
                y={height - padding.bottom + 20}
              >
                {formatX(tick)}
              </text>
            </g>
          ))}
          {numberTicks(minY, maxY, 5, yMinimumStep).map((tick) => (
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
                {formatY(tick)}
              </text>
            </g>
          ))}
          {plotted.map((point) => {
            const focused = focusItemIds.includes(point.itemId);
            const mark = (
              <DataVizPointMark
                cx={x(point.x)}
                cy={y(point.y)}
                opacity={focused ? 1 : focusItemIds.length > 0 ? 0.48 : 0.78}
                outlined={focused}
                seriesId={point.seriesId}
                size={focused ? 5 : 3.5}
              >
                <title>{`${point.label}${focused ? "、この試合" : ""}`}</title>
              </DataVizPointMark>
            );
            return point.href ? (
              <a
                aria-label={`${point.label}の試合結果を見る`}
                className="min-h-11 min-w-11"
                href={point.href}
                key={point.itemId}
              >
                <circle
                  aria-hidden="true"
                  cx={x(point.x)}
                  cy={y(point.y)}
                  fill="transparent"
                  r="22"
                />
                {mark}
              </a>
            ) : (
              <g key={point.itemId}>{mark}</g>
            );
          })}
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
        1点は1人が1試合で残した値です。選択試合は action 色の縁取りで示します。
      </p>
      <DataVizLegend series={seriesIdentity} />
    </figure>
  );
}
