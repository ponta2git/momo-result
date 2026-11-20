import type { ReactNode } from "react";

import {
  ExpectedRankGapAxis,
  ExpectedRankGapTrack,
} from "@/features/seriesComparison/charts/ExpectedRankGapTrack";
import {
  formatGapRank,
  formatGapShare,
  formatRankGap,
  gapDirectionLabel,
  gapSignalLabel,
  isReportedSignal,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import type {
  ExpectedRankGapSummary,
  GapAxis,
} from "@/features/seriesComparison/model/expectedRankGapPresentation";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { cn } from "@/shared/ui/cn";
import { dataTableHeaderCellClassName } from "@/shared/ui/data/DataTable";
import { compactBadgeClass, badgeToneClass } from "@/shared/ui/status/badgeRecipes";
import { contentText } from "@/shared/ui/typography";

export const GAP_COLUMN_COUNT = 7;

/*
 * An ARIA table of grid rows instead of a native table: from the lg breakpoint every row uses
 * one shared column template, so the player and record rows line up on the same axis. Below it
 * a row stacks as "label · count · gap", "expected · actual", chart, and judgement without
 * horizontal scrolling. Changing the display of native table elements would drop their table
 * semantics in some browsers; ARIA roles on generic elements do not depend on display.
 */
const columnTemplate = "lg:grid-cols-[11fr_8fr_8fr_8fr_27fr_10fr_28fr]";
const rowGridClass = cn(
  "grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1 px-3 py-2 lg:gap-0 lg:p-0",
  columnTemplate,
);
const cellClass = "min-w-0 font-plain lg:px-3 lg:py-2";
/** Numbers and their unit never break inside a narrow column. */
const numberCellClass = "tabular-nums whitespace-nowrap";
const placement = {
  label: "col-start-1 row-start-1 lg:col-start-auto lg:row-start-auto",
  count: "col-start-2 row-start-1 text-right lg:col-start-auto lg:row-start-auto",
  expected: "col-start-1 row-start-2 lg:col-start-auto lg:row-start-auto lg:text-right",
  actual:
    "col-span-2 col-start-2 row-start-2 text-right lg:col-span-1 lg:col-start-auto lg:row-start-auto",
  chart: "col-span-3 row-start-3 lg:col-span-1 lg:row-start-auto lg:self-center",
  gap: "col-start-3 row-start-1 text-right lg:col-start-auto lg:row-start-auto",
  judgement: "col-span-3 row-start-4 lg:col-span-1 lg:row-start-auto",
} as const;

export function GapTable({
  axis,
  caption,
  children,
  countHeader,
  labelHeader,
}: {
  axis: GapAxis;
  caption: string;
  children: ReactNode;
  countHeader: string;
  labelHeader: string;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <ExpectedRankGapAxis axis={axis} className="mx-3 lg:hidden" />
      <div
        aria-label={caption}
        className={cn(
          contentText.body,
          "min-w-0 border-t border-b border-border-strong lg:border-t-0",
        )}
        role="table"
      >
        <div className="sr-only lg:not-sr-only" role="rowgroup">
          <div className={cn("lg:grid", columnTemplate)} role="row">
            <div className={cn(dataTableHeaderCellClassName, "text-left")} role="columnheader">
              {labelHeader}
            </div>
            <div className={cn(dataTableHeaderCellClassName, "text-right")} role="columnheader">
              {countHeader}
            </div>
            <div className={cn(dataTableHeaderCellClassName, "text-right")} role="columnheader">
              見込み
            </div>
            <div className={cn(dataTableHeaderCellClassName, "text-right")} role="columnheader">
              実際
            </div>
            <div className={dataTableHeaderCellClassName} role="columnheader">
              <span className="sr-only">見込みとの差の図</span>
              <ExpectedRankGapAxis axis={axis} />
            </div>
            <div className={cn(dataTableHeaderCellClassName, "text-right")} role="columnheader">
              見込みとの差
            </div>
            <div className={cn(dataTableHeaderCellClassName, "text-left")} role="columnheader">
              判定
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GapRowGroup({ children }: { children: ReactNode }) {
  return <div role="rowgroup">{children}</div>;
}

/** A full-width row inside a group: a group heading or a disclosure beneath its rows. */
export function GapGroupRow({
  children,
  heading = false,
}: {
  children: ReactNode;
  heading?: boolean;
}) {
  return (
    <div role="row">
      <div
        aria-colspan={GAP_COLUMN_COUNT}
        className={cn("px-3 py-2", heading ? "pt-4" : "")}
        role="cell"
      >
        {children}
      </div>
    </div>
  );
}

export function GapRow({
  axis,
  countUnit,
  groupLabel,
  judgementAction,
  label,
  marker,
  showShare = true,
  summary,
}: {
  axis: GapAxis;
  countUnit: "件" | "戦";
  /** Read before the row label, so a level row names its record without the group heading. */
  groupLabel?: string | undefined;
  judgementAction?: ReactNode;
  label: ReactNode;
  marker?: number | null | undefined;
  /** The share is omitted where every row covers the whole denominator. */
  showShare?: boolean;
  summary: ExpectedRankGapSummary;
}) {
  const reported = isReportedSignal(summary.signal);
  return (
    <div className={cn(rowGridClass, "border-b border-border lg:border-b-0")} role="row">
      <div className={cn(cellClass, placement.label, "text-text-primary")} role="rowheader">
        {groupLabel ? (
          <>
            <span className="sr-only">{groupLabel}</span>{" "}
          </>
        ) : null}
        {label}
      </div>
      <div className={cn(cellClass, placement.count, numberCellClass)} role="cell">
        <span className="block">
          {summary.count}
          {countUnit}
        </span>
        {showShare ? (
          <span className={cn(contentText.supporting, "block")}>
            {formatGapShare(summary.share)}
          </span>
        ) : null}
      </div>
      <div className={cn(cellClass, placement.expected, numberCellClass)} role="cell">
        <span aria-hidden="true" className={cn(contentText.supporting, "lg:hidden")}>
          見込み{" "}
        </span>
        {formatGapRank(summary.expectedRank)}
      </div>
      <div className={cn(cellClass, placement.actual, numberCellClass)} role="cell">
        <span aria-hidden="true" className={cn(contentText.supporting, "lg:hidden")}>
          実際{" "}
        </span>
        {formatGapRank(summary.averageRank)}
      </div>
      <div className={cn(cellClass, placement.chart)} role="cell">
        <ExpectedRankGapTrack
          axis={axis}
          band={summary.band}
          marker={marker}
          value={summary.meanGap}
        />
      </div>
      <div className={cn(cellClass, placement.gap, numberCellClass)} role="cell">
        <span className={cn("block", reported ? contentText.compactPrimary : "")}>
          {formatRankGap(summary.meanGap)}
        </span>
        {summary.quality === "reference" ? (
          <span className="block">
            <SeriesAnalysisQualityAdvisory status="reference" />
          </span>
        ) : null}
      </div>
      <div className={cn(cellClass, placement.judgement)} role="cell">
        <div className="flex items-center justify-between gap-2 lg:min-h-9">
          <GapJudgement summary={summary} />
          {judgementAction ? <div className="shrink-0">{judgementAction}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The word for a reported gap; a chance gap stays wordless inside its band. The direction is
 * read from the axis sides and the signed value, and is spoken for assistive technology.
 */
function GapJudgement({ summary }: { summary: ExpectedRankGapSummary }) {
  const word = gapSignalLabel(summary.signal);
  const direction = gapDirectionLabel(summary.meanGap);
  if (!word || !direction) return <span />;
  return (
    <span className="inline-flex items-center">
      <span className="sr-only">{direction}、</span>
      <span
        className={cn(
          compactBadgeClass,
          summary.signal === "trend" ? badgeToneClass.attention : badgeToneClass.neutral,
        )}
      >
        {word}
      </span>
    </span>
  );
}
