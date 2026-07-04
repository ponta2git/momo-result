import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type { Player } from "@/features/seriesComparison/SeriesComparisonChartTypes";

export function PlayerLegend({
  players,
  variant = "point",
}: {
  players: Player[];
  variant?: "point" | "line";
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      {players.map((player, index) => (
        <span key={player.memberId} className="inline-flex items-center gap-1.5">
          {variant === "line" ? (
            <svg aria-hidden="true" className="size-7" viewBox="0 0 28 12">
              <line
                stroke={playerColor(index)}
                strokeLinecap="round"
                strokeWidth="2"
                x1="2"
                x2="26"
                y1="6"
                y2="6"
              />
            </svg>
          ) : (
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: playerColor(index) }}
            />
          )}
          <span className="font-medium text-[var(--color-text-primary)]">{player.displayName}</span>
        </span>
      ))}
    </div>
  );
}
