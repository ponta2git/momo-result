import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import { cn } from "@/shared/ui/cn";

export function MatchFeatureSection({ badges }: { badges: MatchFeatureBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <ul aria-label="試合の特徴" className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <li
          key={badge.id}
          aria-label={`${badge.label}。${badge.description}`}
          title={badge.description}
          className={cn(
            "inline-flex min-h-7 items-center gap-2 rounded-full border px-3 py-1 text-xs font-plain text-[var(--color-text-primary)]",
            matchFeatureBadgeClass(badge),
          )}
        >
          {badge.label}
        </li>
      ))}
    </ul>
  );
}

function matchFeatureBadgeClass(badge: MatchFeatureBadge): string {
  if (badge.tone === "notice") {
    return "border-[var(--color-review)]/45 bg-[var(--color-review)]/10";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)]";
}
