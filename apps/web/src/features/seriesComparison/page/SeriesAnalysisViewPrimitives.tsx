import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";

import type { SeriesAnalysisDrilldownSelection } from "@/features/seriesComparison/drilldowns/SeriesAnalysisDrilldownContent";
import type {
  SeriesAnalysisPlayer,
  SeriesComparisonAggregateV3,
} from "@/shared/api/seriesAnalysis";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";
import type { FactListItem } from "@/shared/ui/data/FactList";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function MetricDefinitions({ response }: { response: SeriesComparisonAggregateV3 }) {
  return (
    <Dialog
      description="分析に共通する指標の比べ方を示します。"
      title="指標の読み方"
      trigger={
        <Button icon={<BookOpenText />} size="sm" variant="quiet">
          指標の読み方
        </Button>
      }
    >
      <FactList
        ariaLabel="指標ごとの比べ方"
        columns={2}
        items={response.metricDefinitions.map((definition) => ({
          id: definition.metricId,
          label: definition.label,
          value: metricReadingCue(definition),
        }))}
        layout="plain"
      />
    </Dialog>
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
        <h2 className={contentText.heading} id={headingId}>
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
        <h3 className={contentText.heading} id={headingId}>
          {title}
        </h3>
        {meta ? <span className={cn(contentText.supporting, "tabular-nums")}>{meta}</span> : null}
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
      panelPadding="sm"
      presentation="inset"
      triggerVariant="supporting"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText aria-hidden="true" className="size-4" />
          {summary}
        </span>
      }
    >
      <div className={readableTextWidthClass}>
        <FactList ariaLabel={ariaLabel} items={items} layout="plain" />
      </div>
    </Disclosure>
  );
}

export function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={contentText.supporting}>{label}</dt>
      <dd className={cn(contentText.body, "mt-0.5 tabular-nums")}>{value}</dd>
    </div>
  );
}

export function playerName(players: SeriesAnalysisPlayer[], memberId: string): string {
  return (
    players.find((player) => player.memberId === memberId)?.displayName ?? "プレーヤー名未取得"
  );
}

export function memberNames(players: SeriesAnalysisPlayer[], memberIds: string[]): string {
  return memberIds.map((memberId) => playerName(players, memberId)).join("、") || "—";
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
