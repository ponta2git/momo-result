import { useId, useMemo } from "react";
import type { ReactNode } from "react";

import { numberTicks } from "@/features/seriesComparison/charts/dataViz/scales";
import {
  buildJointDistribution,
  formatRational,
  generateOutlookExamples,
  jointFromCounts,
  projectOutlook,
  rational,
  rationalToNumber,
} from "@/features/seriesComparison/model/outlook";
import type {
  CumulativePair,
  OutlookExample,
  RankDistribution,
  Rational,
} from "@/features/seriesComparison/model/outlook";
import { OutlookChart } from "@/features/seriesComparison/outlook/OutlookChart";
import type {
  OutlookChartPattern,
  OutlookChartPoint,
  OutlookChartSelection,
} from "@/features/seriesComparison/outlook/OutlookChart";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds, orderFixedMembers } from "@/shared/domain/members";
import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/matches/MemberSequenceLabel";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { contentText } from "@/shared/ui/typography";

function signedGap(gap: Rational) {
  const absolute = rational(gap.numerator < 0n ? -gap.numerator : gap.numerator, gap.denominator);
  return `${gap.numerator > 0n ? "+" : gap.numerator < 0n ? "−" : "±"}${formatRational(absolute, 2)}`;
}

function averageSelection(
  cumulative: CumulativePair,
  focus: RankDistribution,
  rival: RankDistribution,
  h: number,
): OutlookChartSelection {
  const projected = projectOutlook(cumulative, focus, rival, h);
  return {
    averages: [rationalToNumber(projected.focusAverage), rationalToNumber(projected.rivalAverage)],
    formatted: [
      formatRational(projected.focusAverage, 2),
      formatRational(projected.rivalAverage, 2),
    ],
    relation: projected.relation,
    gapText: signedGap(projected.gap),
  };
}

function exampleSelection(
  cumulative: CumulativePair,
  example: OutlookExample,
  horizon: number,
): OutlookChartSelection {
  let focus = BigInt(cumulative.focusRankSum);
  let rival = BigInt(cumulative.rivalRankSum);
  for (const [first, second] of example.ranks.slice(0, horizon)) {
    focus += BigInt(first);
    rival += BigInt(second);
  }
  const count = BigInt(cumulative.games) + BigInt(horizon);
  return {
    averages: [Number(focus) / Number(count), Number(rival) / Number(count)],
    formatted: [
      formatRational(rational(focus, count), 2),
      formatRational(rational(rival, count), 2),
    ],
    relation: focus < rival ? "ahead" : focus > rival ? "behind" : "tied",
    gapText: signedGap(rational(rival - focus, count)),
  };
}

export function OutlookPatterns({
  active,
  response,
  cumulative,
  session,
  names,
  memberIds,
  horizonControl,
  onHorizonChange,
  marker,
}: {
  active: boolean;
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  session: OutlookSession;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  horizonControl: ReactNode;
  onHorizonChange: (selection: { horizon: number; horizonText: string }) => void;
  marker: { h: number; label: string } | null;
}) {
  const helpId = useId();
  const entries = session.gesture?.before ?? session.entries;
  const focus = entries[0].distribution;
  const rival = entries[1].distribution;
  const liveFocus = session.entries[0].distribution;
  const liveRival = session.entries[1].distribution;
  const range = session.chartRange;
  const examples = useMemo(() => {
    if (!active) return undefined;
    const record = response.recent.jointRanks.find(
      (pair) => memberIds.includes(pair.memberAId) && memberIds.includes(pair.memberBId),
    );
    if (!record) return null;
    const canonicalIds = canonicalResultMemberIds.filter((id) => memberIds.includes(id)) as [
      string,
      string,
    ];
    const focusFirst = canonicalIds[0] === memberIds[0];
    const observed =
      record.memberAId === canonicalIds[0]
        ? record.rankCounts
        : [0, 1, 2, 3].map((column) =>
            record.rankCounts.map((row) => {
              const value = row[column];
              if (value === undefined) throw new Error("Incomplete joint ranks");
              return value;
            }),
          );
    const joint = buildJointDistribution(
      focusFirst ? focus : rival,
      focusFirst ? rival : focus,
      jointFromCounts(observed),
    );
    return joint
      ? generateOutlookExamples({
          gameTitleId: response.artifact.gameTitleId,
          canonicalMemberIds: canonicalIds,
          focusMemberId: memberIds[0],
          cumulative,
          joint,
          selectionRange: range,
        })
      : null;
  }, [active, response, memberIds, focus, rival, cumulative, range]);

  const meanPoints = useMemo<OutlookChartPoint[]>(() => {
    if (!active) return [];
    return Array.from({ length: range + 1 }, (_, h) => ({
      h,
      averages: averageSelection(cumulative, liveFocus, liveRival, h).averages,
    }));
  }, [active, cumulative, liveFocus, liveRival, range]);
  const exampleSeries = useMemo(
    () =>
      examples?.examples
        .map((example) => ({
          example,
          difference: example.ranks
            .slice(0, range)
            .reduce((sum, [first, second]) => sum + second - first, 0),
          points: example.points.map((point): OutlookChartPoint => ({
            h: point.games,
            averages: [point.focusAverage, point.rivalAverage],
          })),
        }))
        .toSorted((a, b) => b.difference - a.difference) ?? [],
    [examples, range],
  );
  const hasTiedExamples = exampleSeries.some(
    (series, index) => index > 0 && series.difference === exampleSeries[index - 1]?.difference,
  );
  const ticks = useMemo(() => {
    if (!active) return [];
    const bounds = meanPoints.flatMap((point) => [...point.averages]);
    for (const { points } of exampleSeries) {
      for (const point of points) if (point.h <= range) bounds.push(...point.averages);
    }
    // Keep the gesture's starting mean in view while the live mean changes.
    bounds.push(...averageSelection(cumulative, focus, rival, range).averages);
    const low = Math.min(...bounds);
    const high = Math.max(...bounds);
    const padding = (high - low) * 0.08 || 0.01;
    const result = numberTicks(
      Math.max(1, low - padding),
      Math.min(4, high + padding),
      6,
      0.0001,
    ).filter((tick) => tick >= 1 && tick <= 4);
    if (result[0] !== undefined && result[0] > low) result.unshift(1);
    const last = result.at(-1);
    if (last !== undefined && last < high) result.push(4);
    return result;
  }, [active, cumulative, focus, rival, meanPoints, exampleSeries, range]);
  if (!active) return null;

  const current = averageSelection(cumulative, liveFocus, liveRival, 0);
  const patterns: OutlookChartPattern[] = [
    {
      id: "average",
      label: "平均",
      points: meanPoints,
      selected: averageSelection(cumulative, liveFocus, liveRival, session.horizon),
    },
    ...exampleSeries.map(({ example, points }, index): OutlookChartPattern => ({
      id: `example-${index}`,
      label: hasTiedExamples
        ? `展開例${index + 1}`
        : index === 0
          ? "有利な例"
          : index === 1
            ? "中間の例"
            : "不利な例",
      points,
      selected: exampleSelection(cumulative, example, session.horizon),
    })),
  ];
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
        caption={{ content: `現在と${session.horizon}戦後の総合平均順位`, visibility: "visible" }}
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
        <p className={contentText.body}>総合平均順位 · 上の線が先行</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2" aria-label="グラフの凡例">
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
              <span className={contentText.body}>
                {names[role]}
                <span className="sr-only">（{index === 1 ? "破線" : "実線"}）</span>
              </span>
            </span>
          ))}
        </div>
        <p
          id={helpId}
          className={cn(contentText.supporting, "min-h-8")}
          role={session.gesture ? "status" : undefined}
        >
          {session.gesture
            ? "展開例は操作後に更新します。"
            : session.horizon > range
              ? `グラフは${range}戦までです。表は${session.horizon}戦後を表示しています。`
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
            horizon={session.horizon}
            horizonText={session.horizonText}
            range={range}
            ticks={ticks}
            descriptionId={helpId}
            onHorizonChange={onHorizonChange}
            marker={
              pattern.id === "average" && marker
                ? {
                    ...marker,
                    averages: averageSelection(cumulative, liveFocus, liveRival, marker.h).averages,
                  }
                : null
            }
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
