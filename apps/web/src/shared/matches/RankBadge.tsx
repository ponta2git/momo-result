import type { CSSProperties } from "react";

import { rankBadgeBackgroundColor, rankBadgeBorderColor } from "@/shared/matches/rankPresentation";
import { cn } from "@/shared/ui/cn";

export function RankBadge({ rank, size = "sm" }: { rank: number; size?: "md" | "sm" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xs border font-plain text-[var(--color-text-primary)] tabular-nums",
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
    <ol
      aria-label={ariaLabel}
      className="inline-flex max-w-full flex-wrap items-center gap-2"
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari needs an explicit list role when Preflight removes markers.
      role="list"
    >
      {entries.map((entry) => (
        <li key={entry.key} className="inline-flex items-center gap-2">
          {entry.first ? null : (
            <span aria-hidden="true" className="text-[var(--color-text-muted)]">
              {" → "}
            </span>
          )}
          <RankBadge rank={entry.rank} />
        </li>
      ))}
    </ol>
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
