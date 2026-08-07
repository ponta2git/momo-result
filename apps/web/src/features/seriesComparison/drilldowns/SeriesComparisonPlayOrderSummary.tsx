import type { PlayOrderPayload } from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderDrilldownTypes";
import {
  formatDecimal,
  formatPlayOrderLabel,
  isNumber,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";

export function PlayOrderSummary({ data }: { data: PlayOrderPayload }) {
  const summary = data.summary;
  const facts = [
    { label: "対象戦数", value: `${summary.targetCount}戦` },
    { label: "現在の平均順位", value: formatDecimal(summary.currentAverageRank) },
    {
      label: "良かった番手",
      value: formatPlayOrderSummaryValue(summary.bestPlayOrder, summary.bestPlayOrderAverageRank),
    },
    {
      label: "重かった番手",
      value: formatPlayOrderSummaryValue(summary.worstPlayOrder, summary.worstPlayOrderAverageRank),
    },
    { label: "番手差", value: isNumber(summary.spread) ? formatDecimal(summary.spread) : "-" },
    { label: "番手別件数", value: formatCountsByPlayOrder(summary.countsByPlayOrder ?? []) },
  ];
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3 xl:grid-cols-6">
      {facts.map((fact) => (
        <div
          className="min-w-0 rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-3 py-2"
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

function formatPlayOrderSummaryValue(
  playOrder: number | null | undefined,
  averageRank: number | null | undefined,
): string {
  if (!isNumber(playOrder) || !isNumber(averageRank)) {
    return "-";
  }
  return `${formatPlayOrderLabel(playOrder)} 平均${formatDecimal(averageRank)}`;
}

function formatCountsByPlayOrder(rows: Array<{ matchCount: number; playOrder: number }>): string {
  if (rows.length === 0) {
    return "-";
  }
  return rows
    .map((row) => `${formatPlayOrderLabel(row.playOrder)} ${row.matchCount}戦`)
    .join(" / ");
}
