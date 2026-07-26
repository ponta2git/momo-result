import type { CSSProperties } from "react";

const palette = [
  "var(--color-player-1)",
  "var(--color-player-2)",
  "var(--color-player-3)",
  "var(--color-player-4)",
  "var(--color-player-5)",
  "var(--color-player-6)",
];

const dashPatterns = [undefined, "7 3", "2 3", "9 3 2 3", "12 4", "4 2"] as const;

const pointShapes = ["circle", "square", "diamond", "triangle"] as const;

export type PlayerPointShape = (typeof pointShapes)[number];

export function playerColor(index: number): string {
  return palette[index % palette.length] ?? "var(--color-action)";
}

export function playerDashPattern(index: number): string | undefined {
  return dashPatterns[index % dashPatterns.length];
}

export function playerPointShape(index: number): PlayerPointShape {
  return pointShapes[index % pointShapes.length] ?? "circle";
}

export function playerGridStyle(playerCount: number): CSSProperties {
  return { "--player-count": String(Math.max(1, playerCount)) } as CSSProperties;
}
