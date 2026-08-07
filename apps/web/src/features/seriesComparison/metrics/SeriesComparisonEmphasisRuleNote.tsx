import { EmphasisBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";

export function EmphasisRuleNote() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--color-text-secondary)]">
      <span className="font-semibold text-[var(--color-text-primary)]">強調ルール</span>
      <span className="inline-flex items-center gap-2">
        <EmphasisBadge emphasis={{ kind: "strength", label: "強み" }} />
        勝ち筋を支える有利な根拠
      </span>
      <span className="inline-flex items-center gap-2">
        <EmphasisBadge emphasis={{ kind: "risk", label: "注意" }} />
        下振れや負け幅の根拠
      </span>
      <span className="inline-flex items-center gap-2">
        <EmphasisBadge emphasis={{ kind: "leader", label: "4人内最高" }} />
        同じ物件収益指標で4人中最高
      </span>
      <span className="inline-flex items-center gap-2">
        <EmphasisBadge emphasis={{ kind: "evidence", label: "根拠" }} />
        良し悪しではなく型を示す材料
      </span>
    </div>
  );
}
