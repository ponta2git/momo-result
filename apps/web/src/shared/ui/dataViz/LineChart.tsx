import { finiteNumber, indexTicks, niceCeil, numberTicks } from "@/shared/ui/dataViz/scales";
import {
  DataVizLegend,
  DataVizPointMarkWithPresentation,
  createDataVizSeriesPresentationLookup,
} from "@/shared/ui/dataViz/seriesPresentation";
import type { DataVizSeriesIdentity } from "@/shared/ui/dataViz/seriesPresentation";

export type DataVizLineSeries = {
  id: string;
  points: Array<{ index: number; itemId: string; value: number }>;
};

const emptyFocusItemIds: readonly string[] = [];

export function DataVizLineChart({
  ariaLabel,
  domain,
  focusItemIds = emptyFocusItemIds,
  formatIndex = String,
  formatValue,
  lowValueAtTop = false,
  minimumYStep = 1,
  series,
  seriesIdentity,
  xAxisLabel = "試合",
  yAxisLabel,
  yTicks,
}: {
  ariaLabel: string;
  domain?: [number, number] | undefined;
  focusItemIds?: readonly string[];
  formatIndex?: ((value: number) => string) | undefined;
  formatValue: (value: number) => string;
  lowValueAtTop?: boolean;
  minimumYStep?: number;
  series: DataVizLineSeries[];
  seriesIdentity: DataVizSeriesIdentity[];
  xAxisLabel?: string;
  yAxisLabel: string;
  yTicks?: number[] | undefined;
}) {
  const width = 760;
  const height = 320;
  const padding = { bottom: 48, left: 76, right: 24, top: 28 };
  const plottedSeries = series.map((item) => ({
    ...item,
    points: item.points.filter((point) => finiteNumber(point.index) && finiteNumber(point.value)),
  }));
  const values = plottedSeries.flatMap((item) => item.points.map((point) => point.value));
  const allIndexes = plottedSeries.flatMap((item) => item.points.map((point) => point.index));
  const maxIndex = Math.max(1, ...allIndexes);
  const minValue = domain?.[0] ?? Math.min(0, ...values);
  const observedMaximum = values.length === 0 ? minValue + 1 : Math.max(...values);
  const maxValue =
    domain?.[1] ?? niceCeil(Math.max(minValue + minimumYStep, observedMaximum), minimumYStep);
  const ySpan = Math.max(minimumYStep, maxValue - minValue);
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const nameById = new Map(seriesIdentity.map((item) => [item.id, item.label]));
  const focusItemIdSet = new Set(focusItemIds);
  const presentationForSeries = createDataVizSeriesPresentationLookup(
    series.map((item) => item.id),
  );
  const x = (index: number) =>
    padding.left + ((index - 1) / Math.max(1, maxIndex - 1)) * chartWidth;
  const y = (value: number) => {
    const ratio = (value - minValue) / ySpan;
    return padding.top + (lowValueAtTop ? ratio : 1 - ratio) * chartHeight;
  };
  const ticks = yTicks ?? numberTicks(minValue, maxValue, 5, minimumYStep);
  const focusedPoint = plottedSeries
    .flatMap((item) => item.points)
    .find((point) => focusItemIdSet.has(point.itemId));

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
          {focusedPoint ? (
            <g aria-label={`${formatIndex(focusedPoint.index)}を選択中`} className="momo-enter">
              <rect
                fill="var(--color-action)"
                fillOpacity="0.08"
                height={chartHeight}
                width="14"
                x={x(focusedPoint.index) - 7}
                y={padding.top}
              />
              <line
                stroke="var(--color-action)"
                strokeDasharray="3 3"
                strokeWidth="1.8"
                x1={x(focusedPoint.index)}
                x2={x(focusedPoint.index)}
                y1={padding.top}
                y2={height - padding.bottom}
              />
              <text
                fill="var(--color-action)"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
                x={x(focusedPoint.index)}
                y="18"
              >
                この試合
              </text>
            </g>
          ) : null}
          {ticks.map((value) => (
            <g key={value}>
              <line
                stroke="var(--color-border)"
                strokeDasharray="4 4"
                x1={padding.left}
                x2={width - padding.right}
                y1={y(value)}
                y2={y(value)}
              />
              <text
                fill="var(--color-text-secondary)"
                fontSize="11"
                textAnchor="end"
                x={padding.left - 8}
                y={y(value) + 4}
              >
                {formatValue(value)}
              </text>
            </g>
          ))}
          {indexTicks(maxIndex, 6).map((value) => (
            <text
              fill="var(--color-text-secondary)"
              fontSize="11"
              key={value}
              textAnchor={value === 1 ? "start" : value === maxIndex ? "end" : "middle"}
              x={x(value)}
              y={height - 12}
            >
              {formatIndex(value)}
            </text>
          ))}
          {plottedSeries.map((item) => {
            const presentation = presentationForSeries(item.id);
            const path = item.points
              .map(
                (point, index) => `${index === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`,
              )
              .join(" ");
            return (
              <g key={item.id}>
                <title>{nameById.get(item.id) ?? item.id}</title>
                <path
                  data-series-id={item.id}
                  d={path}
                  fill="none"
                  stroke={presentation.color}
                  strokeDasharray={presentation.dash}
                  strokeLinecap="round"
                  strokeWidth="1.8"
                />
                {item.points.length <= 32
                  ? item.points.map((point) => {
                      const focused = focusItemIdSet.has(point.itemId);
                      return (
                        <DataVizPointMarkWithPresentation
                          cx={x(point.index)}
                          cy={y(point.value)}
                          key={point.itemId}
                          outlined={focused}
                          presentation={presentation}
                          seriesId={item.id}
                          size={focused ? 4 : 2.5}
                        />
                      );
                    })
                  : item.points
                      .filter((point) => focusItemIdSet.has(point.itemId))
                      .map((point) => (
                        <DataVizPointMarkWithPresentation
                          cx={x(point.index)}
                          cy={y(point.value)}
                          key={point.itemId}
                          outlined
                          presentation={presentation}
                          seriesId={item.id}
                          size={4}
                        />
                      ))}
              </g>
            );
          })}
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            x={padding.left + chartWidth / 2}
            y={height - 2}
          >
            {xAxisLabel}
          </text>
          <text
            fill="var(--color-text-secondary)"
            fontSize="12"
            textAnchor="middle"
            transform={`rotate(-90 18 ${padding.top + chartHeight / 2})`}
            x="18"
            y={padding.top + chartHeight / 2}
          >
            {yAxisLabel}
          </text>
        </svg>
      </div>
      <DataVizLegend series={seriesIdentity} variant="line" />
    </figure>
  );
}
