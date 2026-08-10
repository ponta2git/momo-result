import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownMetricId } from "@/shared/api/seriesAnalysis";

export function SummaryLine({ items }: { items: string[] }) {
  return <p className="text-sm text-[var(--color-text-secondary)]">{items.join(" ・ ")}</p>;
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <th className="bg-[var(--color-surface-subtle)] px-3 py-2 font-semibold text-[var(--color-text-secondary)]">
      {children}
    </th>
  );
}

export function TableCell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 tabular-nums">{children}</td>;
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
      return "記録外の一撃";
  }
}
