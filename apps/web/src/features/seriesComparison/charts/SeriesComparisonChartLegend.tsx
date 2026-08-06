import type { ReactNode } from "react";

import type { Player } from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import {
  playerColor,
  playerDashPattern,
  playerPointShape,
} from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";

export function PlayerPointMark({
  children,
  cx,
  cy,
  index,
  opacity = 1,
  size = 4,
}: {
  children?: ReactNode;
  cx: number;
  cy: number;
  index: number;
  opacity?: number;
  size?: number;
}) {
  const common = {
    "data-player-shape": playerPointShape(index),
    fill: playerColor(index),
    opacity,
    stroke: "var(--color-surface)",
    strokeWidth: 0.75,
  };
  switch (playerPointShape(index)) {
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

export function PlayerLegend({
  players,
  variant = "point",
}: {
  players: Player[];
  variant?: "point" | "line";
}) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {players.map((player, index) => (
        <span key={player.memberId} className="inline-flex min-w-0 items-center gap-2">
          {variant === "line" ? (
            <svg aria-hidden="true" className="h-3 w-7 shrink-0" viewBox="0 0 28 12">
              <line
                stroke={playerColor(index)}
                strokeDasharray={playerDashPattern(index)}
                strokeLinecap="round"
                strokeWidth="2"
                x1="2"
                x2="26"
                y1="6"
                y2="6"
              />
              <PlayerPointMark cx={14} cy={6} index={index} size={2.25} />
            </svg>
          ) : (
            <svg aria-hidden="true" className="size-3 shrink-0" viewBox="0 0 12 12">
              <PlayerPointMark cx={6} cy={6} index={index} size={4} />
            </svg>
          )}
          <span className="min-w-0 font-medium break-words text-[var(--color-text-primary)]">
            {player.displayName}
          </span>
        </span>
      ))}
    </div>
  );
}
