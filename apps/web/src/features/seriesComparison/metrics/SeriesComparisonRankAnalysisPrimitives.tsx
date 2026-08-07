import type { ReactNode } from "react";

import { StatusBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { rankAnalysisAvailabilityText } from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import type { RankAnalysis } from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";

export function RankAnalysisMeta({
  analysis,
  children,
  status = analysis.status,
}: {
  analysis: RankAnalysis;
  children?: ReactNode;
  status?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]">
      <StatusBadge status={status} />
      <span className="tabular-nums">
        {analysis.heldEventCount}開催・{analysis.matchCount}戦
      </span>
      {children}
    </div>
  );
}

export function RankAnalysisUnavailable({ analysis }: { analysis: RankAnalysis }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-3">
      <RankAnalysisMeta analysis={analysis} />
      <p className="mt-2 text-sm leading-6 text-pretty text-[var(--color-text-secondary)]">
        {rankAnalysisAvailabilityText(analysis)}
      </p>
    </div>
  );
}
