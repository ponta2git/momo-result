import type { ReactNode } from "react";

export type DataVizSeriesIdentity = { id: string; label: string };

const playerColors = [
  "var(--color-player-1)",
  "var(--color-player-2)",
  "var(--color-player-3)",
  "var(--color-player-4)",
  "var(--color-player-5)",
  "var(--color-player-6)",
] as const;

const dashPatterns = [undefined, "7 3", "2 3", "9 3 2 3", "12 4", "4 2"] as const;
const pointShapes = ["circle", "square", "diamond", "triangle"] as const;

export function dataVizSeriesColor(index: number): string {
  return playerColors[index % playerColors.length] ?? "var(--color-action)";
}

export function dataVizSeriesDash(index: number): string | undefined {
  return dashPatterns[index % dashPatterns.length];
}

function dataVizPointShape(index: number) {
  return pointShapes[index % pointShapes.length] ?? "circle";
}

export function DataVizPointMark({
  children,
  cx,
  cy,
  index,
  opacity = 1,
  outlined = false,
  size = 4,
}: {
  children?: ReactNode;
  cx: number;
  cy: number;
  index: number;
  opacity?: number;
  outlined?: boolean;
  size?: number;
}) {
  const common = {
    "data-series-shape": dataVizPointShape(index),
    fill: dataVizSeriesColor(index),
    opacity,
    stroke: outlined ? "var(--color-action)" : "var(--color-surface)",
    strokeWidth: outlined ? 3 : 0.75,
  };
  switch (dataVizPointShape(index)) {
    case "square":
      return (
        <rect {...common} height={size * 2} width={size * 2} x={cx - size} y={cy - size}>
          {children}
        </rect>
      );
    case "diamond":
      return (
        <path
          {...common}
          d={`M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`}
        >
          {children}
        </path>
      );
    case "triangle":
      return (
        <path
          {...common}
          d={`M ${cx} ${cy - size} L ${cx + size} ${cy + size} L ${cx - size} ${cy + size} Z`}
        >
          {children}
        </path>
      );
    default:
      return (
        <circle {...common} cx={cx} cy={cy} r={size}>
          {children}
        </circle>
      );
  }
}

export function DataVizLegend({
  series,
  variant = "point",
}: {
  series: DataVizSeriesIdentity[];
  variant?: "line" | "point";
}) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {series.map((item, index) => (
        <span className="inline-flex min-w-0 items-center gap-2" key={item.id}>
          {variant === "line" ? (
            <svg aria-hidden="true" className="h-3 w-7 shrink-0" viewBox="0 0 28 12">
              <line
                stroke={dataVizSeriesColor(index)}
                strokeDasharray={dataVizSeriesDash(index)}
                strokeLinecap="round"
                strokeWidth="2"
                x1="2"
                x2="26"
                y1="6"
                y2="6"
              />
              <DataVizPointMark cx={14} cy={6} index={index} size={2.25} />
            </svg>
          ) : (
            <svg aria-hidden="true" className="size-3 shrink-0" viewBox="0 0 12 12">
              <DataVizPointMark cx={6} cy={6} index={index} size={4} />
            </svg>
          )}
          <span className="min-w-0 font-medium break-words text-[var(--color-text-primary)]">
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}
