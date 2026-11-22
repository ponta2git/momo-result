/** Horizontal grid lines with their values at the left, in the chart's own text sizes. */
export function ChartYAxis({
  ticks,
  y,
  left,
  right,
  format,
  emphasize,
}: {
  ticks: readonly number[];
  y: (value: number) => number;
  left: number;
  right: number;
  format: (value: number) => string;
  /** A reference value drawn as a stronger line and label, such as a tie. */
  emphasize?: (value: number) => boolean;
}) {
  return (
    <g>
      {ticks.map((tick) => {
        const strong = emphasize?.(tick) ?? false;
        return (
          <g key={tick}>
            <line
              x1={left}
              x2={right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={strong ? "var(--color-text-primary)" : "var(--color-border)"}
              strokeOpacity={strong ? 0.55 : 1}
            />
            <text
              x={left - 7}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize="12"
              fill={strong ? "var(--color-text-primary)" : "var(--color-text-secondary)"}
            >
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Start, middle, and end of the games axis, with its name below. */
export function ChartGamesAxis({
  range,
  x,
  left,
  right,
  bottom,
  height,
}: {
  range: number;
  x: (h: number) => number;
  left: number;
  right: number;
  bottom: number;
  height: number;
}) {
  return (
    <g fontSize="12" fill="var(--color-text-secondary)">
      {[0, Math.round(range / 2), range].map((h) => (
        <text
          key={h}
          x={x(h)}
          y={bottom + 18}
          textAnchor={h === 0 ? "start" : h === range ? "end" : "middle"}
        >
          {h}
        </text>
      ))}
      <text x={(left + right) / 2} y={height - 4} textAnchor="middle">
        この先の試合数
      </text>
    </g>
  );
}
