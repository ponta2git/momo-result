import type { ReactNode } from "react";

import { memberSequence } from "@/shared/domain/members";
import { playOrderPresentation } from "@/shared/ui/data/PlayOrderMark";

export type DataVizSeriesIdentity = { id: string; label: string };
export type DataVizSeriesShape = "circle" | "diamond" | "square" | "triangle";

export type DataVizSeriesPresentation = {
  color: string;
  dash: string | undefined;
  shape: DataVizSeriesShape;
};

const seriesColors = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
] as const;

const dashPatterns = [undefined, "8 3", "2 3", "9 3 2 3", "12 4", "4 2"] as const;
const pointShapes = ["circle", "square", "diamond", "triangle"] as const;

export function playOrderSeriesId(playOrder: 1 | 2 | 3 | 4): string {
  return `play-order:${playOrder}`;
}

function playOrderFromSeriesId(seriesId: string): 1 | 2 | 3 | 4 | null {
  const match = /^play-order:([1-4])$/u.exec(seriesId);
  if (!match) return null;
  const value = Number(match[1]);
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Derives a series' complete visual identity from its stable domain ID. Array order is
 * deliberately absent so filtering or reordering a data set cannot recolor the series.
 */
export function dataVizSeriesPresentation(seriesId: string): DataVizSeriesPresentation {
  const fixedMemberSequence = memberSequence(seriesId);
  if (fixedMemberSequence !== null) {
    return {
      color: `var(--color-member-sequence-${fixedMemberSequence})`,
      dash: dashPatterns[fixedMemberSequence - 1],
      shape: pointShapes[fixedMemberSequence - 1] ?? "circle",
    };
  }

  const playOrder = playOrderFromSeriesId(seriesId);
  if (playOrder !== null) {
    return {
      color: playOrderPresentation(playOrder).color,
      dash: dashPatterns[playOrder],
      shape: pointShapes.toReversed()[playOrder - 1] ?? "circle",
    };
  }

  const colorIndex = stableHash(`series-color:${seriesId}`) % seriesColors.length;
  const dashIndex = stableHash(`series-dash:${seriesId}`) % dashPatterns.length;
  const shapeIndex = stableHash(`series-shape:${seriesId}`) % pointShapes.length;

  return {
    color: seriesColors[colorIndex] ?? "var(--color-series-1)",
    dash: dashPatterns[dashIndex],
    shape: pointShapes[shapeIndex] ?? "circle",
  };
}

export function DataVizPointMark({
  children,
  cx,
  cy,
  opacity = 1,
  outlined = false,
  seriesId,
  size = 4,
}: {
  children?: ReactNode;
  cx: number;
  cy: number;
  opacity?: number;
  outlined?: boolean;
  seriesId: string;
  size?: number;
}) {
  const presentation = dataVizSeriesPresentation(seriesId);
  const common = {
    "data-series-id": seriesId,
    "data-series-shape": presentation.shape,
    fill: presentation.color,
    opacity,
    stroke: outlined ? "var(--color-action)" : "var(--color-surface)",
    strokeWidth: outlined ? 3 : 0.75,
  };

  switch (presentation.shape) {
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
  series: readonly DataVizSeriesIdentity[];
  variant?: "line" | "point";
}) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {series.map((item) => {
        const presentation = dataVizSeriesPresentation(item.id);
        return (
          <span className="inline-flex min-w-0 items-center gap-2" key={item.id}>
            {variant === "line" ? (
              <svg aria-hidden="true" className="h-3 w-7 shrink-0" viewBox="0 0 28 12">
                <line
                  data-series-dash={presentation.dash ?? "solid"}
                  stroke={presentation.color}
                  strokeDasharray={presentation.dash}
                  strokeLinecap="round"
                  strokeWidth="2"
                  x1="2"
                  x2="26"
                  y1="6"
                  y2="6"
                />
                <DataVizPointMark cx={14} cy={6} seriesId={item.id} size={2.25} />
              </svg>
            ) : (
              <svg aria-hidden="true" className="size-3 shrink-0" viewBox="0 0 12 12">
                <DataVizPointMark cx={6} cy={6} seriesId={item.id} size={4} />
              </svg>
            )}
            <span className="min-w-0 font-medium break-words text-[var(--color-text-primary)]">
              {item.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
