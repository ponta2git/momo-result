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
          ? "border-[var(--color-achievement-premium-border)] bg-[var(--color-achievement-premium-surface)] text-[var(--color-achievement-premium-foreground)]"
          : stars === 4
            ? "border-transparent text-[var(--color-achievement-premium-foreground)]"
            : "border-transparent text-[var(--color-text-muted)]",
      )}
    >
      <span aria-hidden="true">{"★".repeat(stars)}</span>
    </span>
  );
}
