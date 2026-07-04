import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import { cn } from "@/shared/ui/cn";
import { Card } from "@/shared/ui/layout/Card";

export function MatchFeatureSection({
  badges,
  scopeLabel,
}: {
  badges: MatchFeatureBadge[];
  scopeLabel: string;
}) {
  return (
    <Card>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">試合の特徴</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{scopeLabel}</p>
          </div>
          <span className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
            {badges.length > 0 ? `${badges.length}件` : "通常"}
          </span>
        </div>
        {badges.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map((badge) => (
              <li
                key={badge.id}
                className={cn(
                  "rounded-[var(--radius-sm)] border px-3 py-2",
                  matchFeatureBadgeClass(badge),
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {badge.label}
                  </span>
                  <span className="rounded-[var(--radius-xs)] border border-current/30 px-1.5 py-0.5 text-[10px] font-semibold text-current">
                    {badge.source === "series" ? "同作品内" : "試合記録"}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  {badge.description}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            目立つ特徴はありません。
          </p>
        )}
      </div>
    </Card>
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
