import {
  formatLowerIsBetterDelta,
  LowerIsBetterDeltaBadge,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type { RankAverageHistoryPayload } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTypes";
import { formatDecimal } from "@/features/seriesComparison/model/seriesComparisonPresentation";

export function RankHistorySummary({ data }: { data: RankAverageHistoryPayload }) {
  const summary = data.summary;
  const facts = [
    { label: "対象戦数", value: `${summary.targetCount}戦` },
    { label: "現在の平均順位", value: formatDecimal(summary.currentAverageRank) },
    {
      label: "直近開催の平均変化",
      value: formatRankAverageDelta(summary.latestHeldEventAverageRankDelta),
    },
  ];
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3">
      {facts.map((fact) => (
        <div
          className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-2.5 py-2"
          key={fact.label}
        >
          <p className="text-[11px] leading-4 text-[var(--color-text-secondary)]">{fact.label}</p>
          <p className="mt-0.5 text-sm font-semibold break-words text-[var(--color-text-primary)] tabular-nums">
            {fact.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function RankAverageDeltaBadge({
  value,
  valueKind,
}: {
  value: number | null | undefined;
  valueKind: "decimal" | "rank";
}) {
  return (
    <LowerIsBetterDeltaBadge
      labels={rankAverageDeltaLabels}
      nullLabel="初戦"
      value={value}
      valueKind={valueKind}
    />
  );
}

const rankAverageDeltaLabels = {
  negative: "改善",
  positive: "後退",
  zero: "維持",
} as const;

function formatRankAverageDelta(value: number | null | undefined): string {
  return formatLowerIsBetterDelta(value, "decimal", rankAverageDeltaLabels, "対象なし");
}
