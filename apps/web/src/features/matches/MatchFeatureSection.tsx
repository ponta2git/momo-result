import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import { cn } from "@/shared/ui/cn";

export function MatchFeatureSection({
  badges,
  scopeLabel,
}: {
  badges: MatchFeatureBadge[];
  scopeLabel: string;
}) {
  return (
    <section aria-label="試合の特徴" className="grid gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">試合の特徴</h2>
        <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">{scopeLabel}</p>
      </div>
      {badges.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <li
              key={badge.id}
              aria-label={`${badge.label}。${badge.description}。${
                badge.source === "series" ? "同条件内の比較" : "試合記録"
              }から判定`}
              title={badge.description}
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold text-[var(--color-text-primary)]",
                matchFeatureBadgeClass(badge),
              )}
            >
              <span>{badge.label}</span>
              <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
                {badge.source === "series" ? "同条件内" : "試合記録"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-text-secondary)]">目立つ特徴はありません。</p>
      )}
    </section>
  );
}

function matchFeatureBadgeClass(badge: MatchFeatureBadge): string {
  if (badge.source === "series") {
    return "border-[var(--color-action)]/35 bg-[var(--color-action)]/8";
  }
  if (badge.tone === "notice") {
    return "border-[var(--color-review)]/45 bg-[var(--color-review)]/10";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)]";
}
