import { cn } from "@/shared/ui/cn";

export function AchievementDifficulty({ stars }: { stars: number }) {
  return (
    <span
      role="img"
      aria-label={`難易度：星${stars}`}
      className={cn(
        "inline-flex min-h-7 items-center rounded-sm border px-2 py-1 text-sm leading-none tracking-widest whitespace-nowrap",
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
