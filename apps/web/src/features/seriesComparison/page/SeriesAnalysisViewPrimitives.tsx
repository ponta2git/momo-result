import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownDialog";
import type {
  SeriesAnalysisPlayer,
  SeriesComparisonAggregateV3,
} from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import type { FactListItem } from "@/shared/ui/data/FactList";

export function MetricDefinitions({ response }: { response: SeriesComparisonAggregateV3 }) {
  return (
    <Disclosure
      ariaLabel="指標の読み方"
      panelClassName="p-3"
      presentation="inset"
      triggerVariant="supporting"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText className="size-4" />
          指標の読み方
        </span>
      }
    >
      <dl className="grid divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:gap-x-6 sm:[&>*:nth-child(2)]:border-t-0">
        {response.metricDefinitions.map((definition) => (
          <div className="py-3" key={definition.metricId}>
            <dt className="text-sm font-semibold">{definition.label}</dt>
            <dd className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {metricReadingCue(definition)}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  );
}

export type AnalysisViewProps = {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
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
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="min-w-0 scroll-mt-24" id={id}>
      <header>
        <h2 className="text-lg font-semibold tracking-tight" id={headingId}>
          {title}
        </h2>
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export type AnalysisFact = FactListItem;

export function AnalysisSubsection({
  children,
  id,
  meta,
  title,
}: {
  children: ReactNode;
  id: string;
  meta?: ReactNode | undefined;
  title: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} id={id}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold" id={headingId}>
          {title}
        </h3>
        {meta ? (
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function AnalysisReadingGuide({
  ariaLabel,
  items,
  summary = "読み方と使いどころ",
}: {
  ariaLabel: string;
  items: readonly AnalysisFact[];
  summary?: string | undefined;
}) {
  return (
    <Disclosure
      ariaLabel={ariaLabel}
      panelClassName="p-3"
      presentation="inset"
      triggerVariant="supporting"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText aria-hidden="true" className="size-4" />
          {summary}
        </span>
      }
    >
      <dl className="grid gap-2 text-sm">
        {items.map((item) => (
          <div className="grid gap-0.5 sm:grid-cols-[7rem_1fr]" key={item.id}>
            <dt className="font-semibold">{item.label}</dt>
            <dd className="text-[var(--color-text-secondary)]">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Disclosure>
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

export function playerName(players: SeriesAnalysisPlayer[], memberId: string): string {
  return players.find((player) => player.memberId === memberId)?.displayName ?? "名前不明";
}

export function memberNames(players: SeriesAnalysisPlayer[], memberIds: string[]): string {
  return (
    orderFixedMembers(
      memberIds.map((memberId) => ({ memberId, name: playerName(players, memberId) })),
    )
      .map(({ name }) => name)
      .join("、") || "—"
  );
}

function metricReadingCue(
  definition: SeriesComparisonAggregateV3["metricDefinitions"][number],
): string {
  const cue = metricReadingCues[definition.metricId];
  if (cue) return cue;
  switch (definition.preferredDirection) {
    case "higher":
      return "対象件数を確認し、他のプレーヤーより大きいかを比べます。";
    case "lower":
      return "対象件数を確認し、他のプレーヤーより小さいかを比べます。";
    case "contextual":
      return "単独で良し悪しを決めず、同じ区画の分布や条件差と合わせて見ます。";
  }
}

const metricReadingCues: Readonly<Partial<Record<string, string>>> = {
  "assets.average": "4人の金額差と分布を比べ、資産をどの水準で残したかを確認します。",
  "destination.conversionDelta":
    "目的地順位と最終順位のずれを比べ、到着回数が順位へつながったかを確認します。",
  "ginji.encounterRate": "低さだけで決めず、遭遇した試合の平均順位と平均資産も合わせて確認します。",
  "podium.rate": "1〜2位で終えた割合です。対象戦数と下位率を一緒に比べます。",
  "rank.average": "1位に近いほど上位です。順位分布と合わせ、平均に隠れた波を確認します。",
  "rank.distribution": "1〜4位の内訳から、平均順位だけでは見えない安定と波を確認します。",
  "revenue.average": "物件収益順位と最終順位を一緒に見て、収益額の大きさだけで勝因を決めません。",
};
