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
  id,
  title,
}: {
  children: ReactNode;
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
      </div>
      {children}
    </section>
  );
}

export function AnalysisFacts({
  ariaLabel,
  items,
}: {
  ariaLabel: string;
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl
      aria-label={ariaLabel}
      className="mb-4 grid gap-px overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2"
    >
      {items.map((item) => (
        <div className="bg-[var(--color-surface-subtle)] px-3 py-2" key={item.label}>
          <dt className="text-[11px] font-semibold text-[var(--color-text-secondary)]">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AnalysisSubsection({
  children,
  meta,
  title,
}: {
  children: ReactNode;
  meta?: ReactNode | undefined;
  title: string;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {meta ? (
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">{meta}</span>
        ) : null}
      </div>
      {children}
    </div>
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
