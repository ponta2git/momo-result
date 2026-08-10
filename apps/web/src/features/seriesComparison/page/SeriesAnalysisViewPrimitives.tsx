import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import type {
  SeriesAnalysisPlayer,
  SeriesComparisonAggregateV2,
} from "@/shared/api/seriesAnalysis";
import { Disclosure } from "@/shared/ui/data/Collapsible";

export function MetricDefinitions({ response }: { response: SeriesComparisonAggregateV2 }) {
  return (
    <Disclosure
      ariaLabel="指標の読み方"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      panelClassName="border-t border-[var(--color-border)] p-3"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText className="size-4" />
          指標の読み方
        </span>
      }
    >
      <dl className="grid gap-2 sm:grid-cols-2">
        {response.metricDefinitions.map((definition) => (
          <div
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2"
            key={definition.metricId}
          >
            <dt className="text-sm font-semibold">{definition.label}</dt>
            <dd className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {metricDirectionDescription(definition.preferredDirection)}
              {metricUnitDescription(definition.unit)}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

export type AnalysisViewProps = {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
  onDrilldown: (selection: SeriesAnalysisDrilldownSelection) => void;
};

export function AnalysisSection({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description?: string | undefined;
  id: string;
  title: string;
}) {
  return (
    <section
      className="min-w-0 scroll-mt-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4"
      id={id}
    >
      <div className="mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
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

export function playerName(players: SeriesAnalysisPlayer[], memberId: string): string {
  return players.find((player) => player.memberId === memberId)?.displayName ?? "名前不明";
}

export function memberNames(players: SeriesAnalysisPlayer[], memberIds: string[]): string {
  return memberIds.map((memberId) => playerName(players, memberId)).join("、") || "—";
}

function metricDirectionDescription(
  direction: SeriesComparisonAggregateV2["metricDefinitions"][number]["preferredDirection"],
): string {
  switch (direction) {
    case "higher":
      return "値が大きいほど強く表れる指標です。";
    case "lower":
      return "値が小さいほど良い指標です。";
    case "contextual":
      return "条件や他の指標と合わせて読みます。";
  }
}

function metricUnitDescription(unit: string): string {
  switch (unit) {
    case "rank":
      return " 順位は1位に近いほど上位です。";
    case "rate":
      return " 割合で表示します。";
    case "man_yen":
      return " 金額は兆・億・万円を組み合わせて表示します。";
    default:
      return "";
  }
}
