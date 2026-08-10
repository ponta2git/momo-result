import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import { formatInteger } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type {
  SeriesAnalysisPlayer,
  SeriesComparisonAggregateV2,
} from "@/shared/api/seriesAnalysis";
import { Disclosure } from "@/shared/ui/data/Collapsible";

export function HistogramTables({ response }: { response: SeriesComparisonAggregateV2 }) {
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <HistogramTable
        label="総資産分布"
        histogram={response.histograms.assets}
        players={response.players}
      />
      <HistogramTable
        label="物件収益分布"
        histogram={response.histograms.revenue}
        players={response.players}
      />
    </div>
  );
}

function HistogramTable({
  histogram,
  label,
  players,
}: {
  histogram: SeriesComparisonAggregateV2["histograms"]["assets"];
  label: string;
  players: SeriesAnalysisPlayer[];
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-border)]">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="px-3 py-2 text-left font-semibold">{label}</caption>
        <thead>
          <tr>
            <TableHead>帯</TableHead>
            {histogram.series.map((series) => (
              <TableHead key={series.memberId}>{playerName(players, series.memberId)}</TableHead>
            ))}
          </tr>
        </thead>
        <tbody>
          {histogram.bins.map((bin) => (
            <tr className="border-t border-[var(--color-border)]" key={bin.index}>
              <TableCell>{bin.label}</TableCell>
              {histogram.series.map((series) => (
                <TableCell key={`${bin.index}:${series.memberId}`}>
                  {formatInteger(series.counts[bin.index])}
                </TableCell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricDefinitions({ response }: { response: SeriesComparisonAggregateV2 }) {
  return (
    <Disclosure
      ariaLabel="指標の定義"
      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
      panelClassName="border-t border-[var(--color-border)] p-3"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText className="size-4" />
          指標の定義
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
              {definition.metricId} / {definition.unit} / {definition.preferredDirection}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

export type AnalysisViewProps = {
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
  return players.find((player) => player.memberId === memberId)?.displayName ?? memberId;
}

export function memberNames(players: SeriesAnalysisPlayer[], memberIds: string[]): string {
  return memberIds.map((memberId) => playerName(players, memberId)).join("、") || "—";
}
