import { BookOpenText } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";
import type { FactListItem } from "@/shared/ui/data/FactList";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function MetricDefinitions() {
  return (
    <Dialog
      description="どの指標も、選択した範囲で本人が参加した試合を分母にしています。"
      title="指標の読み方"
      trigger={
        <Button icon={<BookOpenText />} size="sm" variant="quiet">
          指標の読み方
        </Button>
      }
    >
      <FactList ariaLabel="指標ごとの比べ方" columns={2} items={metricReadings} layout="plain" />
    </Dialog>
  );
}

export function AnalysisSection({
  children,
  id,
  meta,
  title,
}: {
  children: ReactNode;
  id: string;
  meta?: ReactNode;
  title: string;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 scroll-mt-(--sticky-below-nav) gap-2"
      id={id}
    >
      <header
        className={
          meta ? "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" : undefined
        }
      >
        <h2 className={contentText.heading} id={headingId} tabIndex={-1}>
          {title}
        </h2>
        {meta}
      </header>
      <div className="min-w-0">{children}</div>
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
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2" id={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={contentText.heading} id={headingId} tabIndex={-1}>
          {title}
        </h3>
        {meta ? <span className={cn(contentText.supporting, "tabular-nums")}>{meta}</span> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function AnalysisReadingGuide({
  ariaLabel,
  children,
  items,
  summary = "読み方と使いどころ",
}: {
  ariaLabel: string;
  /** Reference material that belongs to the same reading, such as a basis table. */
  children?: ReactNode;
  items: readonly AnalysisFact[];
  summary?: string | undefined;
}) {
  return (
    <Disclosure
      ariaLabel={ariaLabel}
      panelPadding="sm"
      triggerVariant="supporting"
      summary={
        <span className="inline-flex items-center gap-2">
          <BookOpenText aria-hidden="true" className="size-4" />
          {summary}
        </span>
      }
    >
      <div className="grid gap-4">
        <div className={readableTextWidthClass}>
          <FactList ariaLabel={ariaLabel} items={items} layout="plain" />
        </div>
        {children}
      </div>
    </Disclosure>
  );
}

/**
 * What each shared metric needs beyond its name: a baseline, what the value hides, how two
 * columns relate, or where the rule-given part is read instead. Definitions that the name or
 * unit already states are not repeated.
 */
const metricReadings = [
  {
    id: "rank.average",
    label: "平均順位",
    value:
      "同順位がなければ4人を合わせた平均は2.5位で、2.5位より小さい人が4人の中で平均より上です。先頭と次点が近いときは「平均順位首位の確からしさ」で、開催の偏りで並んだだけかを確かめます。",
  },
  {
    id: "rank.distribution",
    label: "順位分布",
    value:
      "同じ平均順位でも、1位と4位が多い人と2・3位が多い人がいます。1位の多さと4位の少なさのどちらで平均を作っているかを見ます。",
  },
  {
    id: "rank.standardDeviation",
    label: "順位のぶれ",
    value:
      "毎試合の順位の散らばり（標準偏差）です。毎回同じ順位なら0、1〜4位を同じ回数ずつ取ると約1.1、1位と4位だけなら1.5です。",
  },
  {
    id: "podium.rate",
    label: "入賞率・下位率",
    value: "入賞は1〜2位、下位は3〜4位で、2つを合わせると100%です。",
  },
  {
    id: "assets.average",
    label: "平均総資産",
    value:
      "最終順位を直接決める値です。大勝した試合があると平均が大きく上がるため、中央値や分布と比べて、一部の試合に引っ張られていないかを見ます。",
  },
  {
    id: "revenue.average",
    label: "平均物件収益",
    value:
      "物件収益と目的地の到着が多いほど総資産が増え、上位になりやすいのはルール上当然です。この2つから見込まれる順位との差は「見込みとの差」で読みます。",
  },
  {
    id: "destination.average",
    label: "目的地到着回数（1試合平均）",
    value: "オーナー比較では列ごとに対象戦数が違い、その列の戦数で割ります。",
  },
  {
    id: "destination.conversionDelta",
    label: "目的地順位と最終順位の差",
    value:
      "平均目的地順位から平均最終順位を引いた値です。＋なら、到着回数の順位より上位で終えています。",
  },
  {
    id: "ginji",
    label: "銀次遭遇率・遭遇回数（1試合平均）",
    value:
      "遭遇率は1回以上遭った試合の割合で、同じ試合で何回遭っても1試合と数えます。遭遇回数を遭遇率で割ると、遭った試合での平均回数になります。",
  },
];
