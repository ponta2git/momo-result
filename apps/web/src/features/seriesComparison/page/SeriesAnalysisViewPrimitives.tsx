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
      description="分析に共通する指標の比べ方を示します。"
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
        <h2 className={contentText.heading} id={headingId} tabIndex={-1}>
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
        <h3 className={contentText.heading} id={headingId} tabIndex={-1}>
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

const metricReadings = [
  {
    id: "rank.average",
    label: "平均順位",
    value: "1位に近いほど上位です。順位分布と合わせ、平均に隠れた波を確認します。",
  },
  {
    id: "rank.distribution",
    label: "順位分布",
    value: "1〜4位の内訳から、平均順位だけでは見えない安定と波を確認します。",
  },
  {
    id: "assets.average",
    label: "平均総資産",
    value: "4人の金額差と分布を比べ、資産をどの水準で残したかを確認します。",
  },
  {
    id: "revenue.average",
    label: "平均物件収益",
    value: "物件収益順位と最終順位を一緒に見て、収益額の大きさだけで勝因を決めません。",
  },
  {
    id: "podium.rate",
    label: "入賞率",
    value: "1〜2位で終えた割合です。対象戦数と下位率を一緒に比べます。",
  },
  {
    id: "ginji.encounterRate",
    label: "銀次遭遇率",
    value:
      "対象試合のうち、1回以上銀次に遭遇した試合の割合です。1試合平均の遭遇回数とは異なります。",
  },
  {
    id: "destination.average",
    label: "目的地到着回数（1試合平均）",
    value:
      "目的地への到着回数を対象戦数で割った回数（回/試合）です。オーナー比較では列の対象戦数を使います。",
  },
  {
    id: "ginji.average",
    label: "銀次遭遇回数（1試合平均）",
    value:
      "銀次の合計遭遇回数を対象戦数で割った回数（回/試合）です。同じ試合での複数回遭遇も含みます。",
  },
  {
    id: "destination.conversionDelta",
    label: "目的地順位と最終順位の差",
    value: "目的地順位と最終順位のずれを比べ、到着回数が順位へつながったかを確認します。",
  },
];
