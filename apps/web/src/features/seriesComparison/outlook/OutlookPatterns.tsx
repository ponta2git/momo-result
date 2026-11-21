import { useId } from "react";
import type { ReactNode } from "react";

import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import { OutlookChart } from "@/features/seriesComparison/outlook/OutlookChart";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import { useOutlookPatterns } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

export function OutlookPatterns({
  active,
  response,
  cumulative,
  view,
  names,
  memberIds,
  horizonControl,
  onHorizonChange,
  marker,
}: {
  active: boolean;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  view: OutlookResultView;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  horizonControl: ReactNode;
  onHorizonChange: (selection: { horizon: number; horizonText: string }) => void;
  marker: { h: number; label: string } | null;
}) {
  const helpId = useId();
  const range = view.chartRange;
  const { examples, patterns, hasTiedExamples, ticks, current, averageMarker } = useOutlookPatterns(
    { active, response, cumulative, view, memberIds, marker },
  );
  if (!active) return null;

  const people = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  );
  const exampleDescription = !examples
    ? "この条件の展開例を表示できません。平均どおりに進んだ場合を表示しています。"
    : examples.constantPerGameDifference
      ? "この内訳では、どの展開例も2人の差は同じ推移になります。"
      : examples.distinctCandidateCount < 3
        ? `${range}戦までの2人の差は${examples.distinctCandidateCount}種類の推移になり、同じ推移の例を含みます。`
        : hasTiedExamples
          ? `${range}戦後の2人の差が同じになる例を含みます。`
          : `${names[0]}にとって${range}戦後の差が有利・中間・不利な展開例です。`;
  const rows = [{ id: "current", label: "現在", selected: current }, ...patterns];
  return (
    <div className="@container/outlook-patterns grid min-w-0 grid-cols-1 gap-4">
      {horizonControl}
      <DataTable
        caption={{ content: `現在と${view.horizon}戦後の総合平均順位`, visibility: "visible" }}
        density="compact"
        verticalAlign="top"
        layout="fixed"
        rows={rows}
        getRowKey={(row) => row.id}
        columns={[
          {
            key: "pattern",
            header: "展開",
            rowHeader: true,
            width: "34%",
            renderCell: (row) => row.label,
          },
          ...people.map(({ memberId, role }) => ({
            key: memberId,
            header: (
              <span className="inline-flex min-h-8 items-center">
                <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
              </span>
            ),
            align: "right" as const,
            tabular: true,
            renderCell: (row: (typeof rows)[number]) => (
              <span className="grid content-start gap-1">
                <span className="whitespace-nowrap">{row.selected.formatted[role]}位</span>
                {role === 0 ? (
                  <span
                    className={cn(contentText.supporting, "whitespace-nowrap")}
                    aria-label={`相手との差 ${row.selected.gapText}位`}
                  >
                    （{row.selected.gapText}位）
                  </span>
                ) : null}
              </span>
            ),
          })),
        ]}
      />
      <div className="grid gap-2">
        <p className={contentText.supporting}>{names[0]}の差：＋は上位、−は下位。</p>
        <p className={contentText.body}>総合平均順位・上の線が先行</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="グラフの凡例">
          {people.map(({ memberId, role }, index) => (
            <span key={memberId} className="inline-flex min-w-0 items-center gap-2">
              <svg width="24" height="8" aria-hidden="true" className="shrink-0">
                <line
                  x1="0"
                  x2="24"
                  y1="4"
                  y2="4"
                  stroke={memberSequencePresentation(memberId).color}
                  strokeWidth="2.5"
                  strokeDasharray={index === 1 ? "6 4" : undefined}
                />
              </svg>
              <span className="min-w-0 text-xs font-plain break-words text-text-primary">
                {names[role]}
                <span className="sr-only">（{index === 1 ? "破線" : "実線"}）</span>
              </span>
            </span>
          ))}
        </div>
        <p
          id={helpId}
          className={cn(contentText.supporting, "min-h-8")}
          role={view.gesturing ? "status" : undefined}
        >
          {view.gesturing
            ? "展開例は操作後に更新します。"
            : view.horizon > range
              ? `グラフは${range}戦までです。表は${view.horizon}戦後を表示しています。`
              : "タップ・横ドラッグ・矢印キーで戦数を選べます。"}
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-6 @xl/outlook-patterns:grid-cols-2">
        {patterns.map((pattern) => (
          <OutlookChart
            key={pattern.id}
            pattern={pattern}
            names={names}
            memberIds={memberIds}
            horizon={view.horizon}
            horizonText={view.horizonText}
            range={range}
            ticks={ticks}
            descriptionId={helpId}
            onHorizonChange={onHorizonChange}
            marker={pattern.id === "average" ? averageMarker : null}
          />
        ))}
      </div>
      <div className="grid gap-2">
        <p className={contentText.supporting}>
          数値は小数第2位に丸めていますが、同率の判定は丸める前の値を使います。
        </p>
        <p className={contentText.supporting}>
          {exampleDescription}
          {examples ? "確率や上下限を示すものではありません。" : null}
        </p>
      </div>
    </div>
  );
}
