import type { MatchFeatureBadge } from "@/features/matches/matchDetailViewModel";
import type { MatchFeatureView } from "@/features/matches/matchFeatureViewModel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";

export function MatchFeatureSection({ view }: { view: MatchFeatureView }) {
  const ready = view.kind === "ready-empty" || view.kind === "with-items";

  return (
    <section aria-label="試合の特徴" className="grid gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-xs font-semibold text-[var(--color-text-primary)]">試合の特徴</h2>
        {ready ? (
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            {view.scopeLabel}
          </p>
        ) : null}
      </div>
      {view.kind === "with-items" ? (
        <ul className="flex flex-wrap gap-2">
          {view.badges.map((badge) => (
            <li
              key={badge.id}
              aria-label={`${badge.label}。${badge.description}。${
                badge.source === "series" ? "同条件内の比較" : "試合記録"
              }から判定`}
              title={badge.description}
              className={cn(
                "inline-flex min-h-7 items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)]",
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
      ) : null}
      {view.kind === "ready-empty" ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          同じ条件の試合と比べて、表示対象の特徴はありません。
        </p>
      ) : null}
      {view.kind === "loading" ? (
        <p className="text-xs text-[var(--color-text-secondary)]" role="status">
          同じ条件の試合との特徴を確認しています。
        </p>
      ) : null}
      {view.kind === "load-failed" ? (
        <Notice
          action={
            <Button
              pending={view.retrying}
              pendingLabel="特徴を再読み込み中"
              size="sm"
              variant="secondary"
              onClick={view.onRetry}
            >
              特徴を再読み込み
            </Button>
          }
          title="試合の特徴を読み込めません"
          tone="warning"
        >
          <p>順位・総資産は表示したままです。通信状態を確認して再読み込みしてください。</p>
        </Notice>
      ) : null}
      {view.kind === "unavailable" ? (
        <p className="text-xs text-[var(--color-text-secondary)]">{view.message}</p>
      ) : null}
    </section>
  );
}

function matchFeatureBadgeClass(badge: MatchFeatureBadge): string {
  if (badge.source === "series") {
    return "border-[var(--color-analysis-emphasis)]/35 bg-[var(--color-analysis-emphasis)]/8";
  }
  if (badge.tone === "notice") {
    return "border-[var(--color-review)]/45 bg-[var(--color-review)]/10";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface-subtle)]";
}
