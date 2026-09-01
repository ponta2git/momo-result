import type { CSSProperties } from "react";

import { cn } from "@/shared/ui/cn";
import { rankBadgeBackgroundColor, rankBadgeBorderColor } from "@/shared/ui/rank/rankPresentation";

export function RankBadge({ rank, size = "sm" }: { rank: number; size?: "md" | "sm" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-xs)] border font-semibold text-[var(--color-text-primary)] tabular-nums",
        size === "md" ? "min-h-10 min-w-14 px-2 text-lg" : "min-h-6 min-w-9 px-2 text-xs",
      )}
      style={
        {
          backgroundColor: rankBadgeBackgroundColor(rank),
          borderColor: rankBadgeBorderColor(rank),
        } satisfies CSSProperties
      }
    >
      {rank}位
    </span>
  );
}

export function RankTrail({ ariaLabel, ranks }: { ariaLabel: string; ranks: readonly number[] }) {
  const entries = rankTrailEntries(ranks);
  return (
    <span aria-label={ariaLabel} className="inline-flex max-w-full flex-wrap items-center gap-2">
      {entries.map((entry) => (
        <span key={entry.key} className="inline-flex items-center gap-2">
          {entry.first ? null : (
            <span aria-hidden="true" className="text-[var(--color-text-muted)]">
              {" → "}
            </span>
          )}
          <RankBadge rank={entry.rank} />
        </span>
      ))}
    </span>
  );
}

function rankTrailEntries(ranks: readonly number[]) {
  const occurrences = new Map<number, number>();
  const entries: Array<{ first: boolean; key: string; rank: number }> = [];
  for (const rank of ranks) {
    const occurrence = (occurrences.get(rank) ?? 0) + 1;
    occurrences.set(rank, occurrence);
    entries.push({ first: entries.length === 0, key: `${rank}-${occurrence}`, rank });
  }
  return entries;
}
