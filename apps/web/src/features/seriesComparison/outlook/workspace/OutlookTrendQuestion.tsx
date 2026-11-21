import { useMemo, useState } from "react";

import { projectOutlook, rationalToNumber } from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import type { OutlookTrendAnswer } from "@/features/seriesComparison/outlook/outlookAnswers";
import type { OutlookTrajectoryModel } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import { OutlookGapChart } from "@/features/seriesComparison/outlook/workspace/OutlookGapChart";
import { OutlookQuestion } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

function exampleNote(patterns: OutlookTrajectoryModel, range: number, gesturing: boolean) {
  if (gesturing) return "展開例は操作を終えると更新します。";
  if (patterns.status === "failed")
    return "展開例を計算できませんでした。平均どおりの線は使えます。";
  if (patterns.status === "unavailable") return "この条件では展開例を作れません。";
  if (patterns.constantPerGameDifference) return "この内訳では、どの展開例も差は同じ推移です。";
  const note = `細い線は試合ごとのブレを入れた展開例です（${range}戦後の差の順。確率ではありません）。`;
  const distinct = patterns.distinctCandidateCount;
  return distinct !== null && distinct < 3
    ? `${note}異なる推移が${distinct}通りしかないため、同じ線が重なります。`
    : note;
}

/** 「この平均が続くと」: the first strict lead, then how the difference moves and can swing. */
export function OutlookTrendQuestion({
  names,
  memberIds,
  cumulative,
  pair,
  origin,
  answer,
  patterns,
  range,
  gesturing,
}: {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  cumulative: CumulativePair;
  pair: readonly [RankDistribution, RankDistribution];
  origin: readonly [RankDistribution, RankDistribution];
  answer: OutlookTrendAnswer;
  patterns: OutlookTrajectoryModel;
  range: number;
  gesturing: boolean;
}) {
  const originAverage = useMemo(
    () =>
      gesturing
        ? Array.from({ length: range + 1 }, (_, h) =>
            rationalToNumber(projectOutlook(cumulative, origin[0], origin[1], h).gap),
          )
        : [],
    [gesturing, range, cumulative, origin],
  );
  const averagesAt = (h: number) => {
    const projected = projectOutlook(cumulative, pair[0], pair[1], h);
    return [projected.focusAverage, projected.rivalAverage] as const;
  };
  const support = [answer.tie, answer.recentComparison].filter(Boolean).join(" ・ ");
  // Announce the answer once a gesture settles, not at every step of a drag.
  const [settled, setSettled] = useState(answer.headline);
  if (!gesturing && settled !== answer.headline) setSettled(answer.headline);
  return (
    <OutlookQuestion
      labelledBy="outlook-question-trend"
      question={
        <h2 id="outlook-question-trend" className={contentText.heading}>
          この平均が続くと
        </h2>
      }
      answer={
        <>
          <p className={cn(contentText.primary, "text-pretty")}>{answer.headline}</p>
          <p className="sr-only" aria-live="polite">
            {settled}
          </p>
        </>
      }
      support={
        <>
          <p className={contentText.supporting}>{support}</p>
          {answer.nextGame ? <p className={contentText.supporting}>{answer.nextGame}</p> : null}
        </>
      }
      chart={
        <OutlookGapChart
          names={names}
          memberIds={memberIds}
          trajectories={patterns.trajectories}
          originAverage={originAverage}
          range={range}
          marker={answer.marker}
          averagesAt={averagesAt}
          ariaLabel={`${names[0]}から見た総合平均の差の推移。${answer.headline}。`}
        />
      }
      notes={
        <div className={cn(contentText.supporting, "grid content-start gap-1")}>
          <p role={gesturing ? "status" : undefined}>{exampleNote(patterns, range, gesturing)}</p>
          {answer.beyondRange ? <p>{answer.beyondRange}</p> : null}
        </div>
      }
    />
  );
}
