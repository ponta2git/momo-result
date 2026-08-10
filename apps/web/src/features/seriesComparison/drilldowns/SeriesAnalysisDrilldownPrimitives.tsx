import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownMetricId } from "@/shared/api/seriesAnalysis";

export function DrilldownFacts({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{ id: string; label: string; value: ReactNode }>;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className="grid gap-px overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4"
    >
      {items.map((item) => (
        <div className="bg-[var(--color-surface-subtle)] px-3 py-2" key={item.id}>
          <dt className="text-[11px] text-[var(--color-text-secondary)]">{item.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function drilldownTitle(metricId: SeriesAnalysisDrilldownMetricId): string {
  switch (metricId) {
    case "rank.averageHistory":
      return "平均順位の推移";
    case "playOrder.rankHistory":
      return "番手別順位の推移";
    case "rankAnalysis.rankSignals":
      return "順位を読む手掛かり";
    case "rankAnalysis.unexpectedWins":
      return "予測より上位だった勝利";
  }
}
