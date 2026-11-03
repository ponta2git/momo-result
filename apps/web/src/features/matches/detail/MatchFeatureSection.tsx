import type { MatchFeatureBadge } from "@/features/matches/detail/matchDetailPresentation";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { compactBadgeClass, compactBadgeToneClass } from "@/shared/ui/status/badgeRecipes";

/**
 * Features come from the separate analysis read. While it is pending, one badge row stays
 * reserved so the result ledger does not move when the features arrive. A completed read
 * without features removes the row, because that is the data rather than a wait.
 */
export function MatchFeatureSection({
  badges,
  loading,
}: {
  badges: MatchFeatureBadge[];
  loading: boolean;
}) {
  if (loading) return <MatchFeaturePlaceholder />;
  if (badges.length === 0) return null;
  return (
    <ul aria-label="試合の特徴" className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <li
          key={badge.id}
          aria-label={`${badge.label}。${badge.description}`}
          title={badge.description}
          className={cn(
            compactBadgeClass,
            compactBadgeToneClass[badge.tone === "notice" ? "attention" : "neutral"],
          )}
        >
          {badge.label}
        </li>
      ))}
    </ul>
  );
}

export function MatchFeaturePlaceholder() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-2">
      <Skeleton className="h-6 w-16" />
      <Skeleton className="h-6 w-24" />
    </div>
  );
}
