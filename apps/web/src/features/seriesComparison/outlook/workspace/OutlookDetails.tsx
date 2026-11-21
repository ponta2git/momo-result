import { useMemo } from "react";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import type {
  CumulativePair,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/outlook/calculation";
import {
  outlookDetailRows,
  outlookRequirementText,
} from "@/features/seriesComparison/outlook/outlookAnswers";
import type { OutlookDetailRow } from "@/features/seriesComparison/outlook/outlookAnswers";
import {
  exactAverageFraction,
  outlookAverage,
  signedOutlookGap,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

/**
 * Exact values and premises, folded away from the answers. The table carries every value the two
 * graphs draw at the usual horizons and at the goal, so it also stands in for them.
 */
export function OutlookDetails({
  summary,
  selection,
  names,
  displayRoles,
  recent,
  cumulative,
  pair,
  goalHorizon,
  exampleLabels,
  exampleGapsAt,
}: {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  names: readonly [string, string];
  displayRoles: ReadonlyArray<{ memberId: string; role: OutlookRole }>;
  recent: readonly [RankDistribution, RankDistribution];
  cumulative: CumulativePair;
  pair: readonly [RankDistribution, RankDistribution];
  goalHorizon: number;
  exampleLabels: readonly string[];
  exampleGapsAt: (h: number) => readonly Rational[];
}) {
  const rows = useMemo(
    () => outlookDetailRows({ cumulative, pair, goalHorizon, exampleGapsAt }),
    [cumulative, pair, goalHorizon, exampleGapsAt],
  );
  const period = summary.recent.period
    ? `（${formatDateOnly(summary.recent.period.startedAt)}〜${formatDateOnly(summary.recent.period.endedAt)}）`
    : "";
  return (
    <Disclosure
      summary="詳しい数値と計算の前提"
      ariaLabel="詳しい数値と計算の前提"
      panelSpacing="sm"
    >
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <p className={cn(contentText.supporting, readableTextWidthClass)}>
          差は{names[0]}から見た総合平均の差で、＋なら{names[0]}が上です。必要な平均は、
          {names[1]}がこれからの平均を続けるとき、{names[0]}がその時点で上回るための平均です。
        </p>
        <DataTable
          caption={{
            content: "この先の総合平均、差、上回るのに必要な平均",
            visibility: "screen-reader",
          }}
          rows={rows}
          getRowKey={(row) => String(row.h)}
          density="compact"
          minWidth="46rem"
          stickyRowHeader
          columns={[
            {
              key: "h",
              header: "この先",
              rowHeader: true,
              renderCell: (row: OutlookDetailRow) =>
                row.h === 0 ? "今" : `${row.h}戦後${row.goal ? "・目標" : ""}`,
            },
            ...displayRoles.map(({ memberId, role }) => ({
              key: memberId,
              header: <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>,
              align: "right" as const,
              tabular: true,
              renderCell: (row: OutlookDetailRow) =>
                `${outlookAverage(role === 0 ? row.focusAverage : row.rivalAverage)}位`,
            })),
            {
              key: "gap",
              header: "差（平均どおり）",
              align: "right" as const,
              tabular: true,
              renderCell: (row: OutlookDetailRow) => signedOutlookGap(row.gap),
            },
            ...exampleLabels.map((label, index) => ({
              key: `example-${index}`,
              header: label,
              align: "right" as const,
              tabular: true,
              renderCell: (row: OutlookDetailRow) => {
                const gap = row.exampleGaps[index];
                return gap ? signedOutlookGap(gap) : "—";
              },
            })),
            {
              key: "required",
              header: `${names[0]}に必要な平均`,
              align: "right" as const,
              tabular: true,
              renderCell: (row: OutlookDetailRow) =>
                row.required ? outlookRequirementText(row.required, names[1]) : "—",
            },
          ]}
        />
        <div className={cn("grid gap-2", readableTextWidthClass)}>
          <p className={contentText.body}>
            {selection.seasonMasterId
              ? `選んだシーズンの${summary.scope.matchCount}戦に、この先の試合を加えた場合の見通しです。`
              : `今の総合平均は選んだ範囲の${summary.scope.matchCount}戦です。`}
            これからの平均の初期値は作品全体の直近{summary.recent.matchCount}戦{period}
            で、この先も同じ平均の成績が続く条件で計算しています。
            {summary.recent.qualityStatus === "reference"
              ? "直近の実績が少ないため、見通しは参考値です。"
              : null}
          </p>
          <p className={contentText.supporting}>
            表示を丸めても、同率・逆転は丸める前の値で判定しています。{names[0]}の直近平均：
            {exactAverageFraction(recent[0])}、{names[1]}：{exactAverageFraction(recent[1])}
            （順位合計 / 戦数）。
          </p>
        </div>
      </div>
    </Disclosure>
  );
}
