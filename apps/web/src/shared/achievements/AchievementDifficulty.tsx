import { cn } from "@/shared/ui/cn";
import { compactBadgeClass } from "@/shared/ui/status/badgeRecipes";

export function AchievementDifficulty({ stars }: { stars: number }) {
  return (
    <span
      role="img"
      aria-label={`難易度：星${stars}`}
      className={cn(
        compactBadgeClass,
        // Stars are the difficulty value itself, so they keep the readable data size inside
        // the shared badge box rather than shrinking to the label size.
        "text-sm/4 tracking-widest",
        stars >= 5
          ? "border-achievement-premium-border bg-achievement-premium-surface text-achievement-premium-foreground"
          : stars === 4
            ? "border-transparent text-achievement-premium-foreground"
            : "border-transparent text-text-muted",
      )}
    >
      <span aria-hidden="true">{"★".repeat(stars)}</span>
    </span>
  );
}
