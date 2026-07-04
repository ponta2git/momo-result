import type { CSSProperties } from "react";

const palette = [
  "var(--color-player-1)",
  "var(--color-player-2)",
  "var(--color-player-3)",
  "var(--color-player-4)",
  "var(--color-player-5)",
  "var(--color-player-6)",
];

export function playerColor(index: number): string {
  return palette[index % palette.length] ?? "var(--color-action)";
}

export function playerGridStyle(playerCount: number): CSSProperties {
  return { "--player-count": String(Math.max(1, playerCount)) } as CSSProperties;
}
