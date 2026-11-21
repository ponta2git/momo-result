import { useId, useRef, useState } from "react";

import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import { outlookBestRecord } from "@/features/seriesComparison/outlook/outlookAnswers";
import type { OutlookGoalAnswer } from "@/features/seriesComparison/outlook/outlookAnswers";
import type { OutlookResultView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookApplyBlock } from "@/features/seriesComparison/outlook/outlookProposals";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/outlookProposals";
import type { useOutlookGoal } from "@/features/seriesComparison/outlook/useOutlookGoal";
import { OutlookGoalExamples } from "@/features/seriesComparison/outlook/workspace/OutlookGoalExamples";
import { OutlookNeedLineChart } from "@/features/seriesComparison/outlook/workspace/OutlookNeedLineChart";
import { OutlookQuestion } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { isImeComposing } from "@/shared/lib/ime";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { contentText, fieldText } from "@/shared/ui/typography";

/** Why the required mean cannot be tried right now, stated next to the action. */
export function goalBlockText(block: OutlookApplyBlock | null, rivalName: string) {
  switch (block) {
    case "gesture":
      return "平均順位の操作を終えると試せます。";
    case "rival-pending":
      return `${rivalName}の入力を反映するか、取り消すと試せます。`;
    case "invalid-goal":
      return "目標の戦数を1〜1000で入力すると試せます。";
    default:
      return null;
  }
}

/** 「目標の戦数で上回るには」: the strict requirement, what it assumes, and where to look next. */
export function OutlookGoalQuestion({
  summary,
  names,
  memberIds,
  cumulative,
  view,
  answer,
  goal,
  range,
  trendMarker,
  reviewHref,
  matchHref,
  matchLabel,
}: {
  summary: SeriesAnalysisOutlookSummary;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  cumulative: CumulativePair;
  view: OutlookResultView;
  answer: OutlookGoalAnswer;
  goal: ReturnType<typeof useOutlookGoal>;
  range: number;
  trendMarker: Readonly<{ h: number; label: string }> | null;
  reviewHref: string;
  matchHref: string;
  matchLabel: string;
}) {
  const inputId = useId();
  const blockId = useId();
  const answerRef = useRef<HTMLParagraphElement>(null);
  const [validateBlank, setValidateBlank] = useState(false);
  const blank = view.goalHorizonText === "";
  const invalid =
    parseOutlookHorizon(view.goalHorizonText) === undefined && (!blank || validateBlank);
  const block = goalBlockText(goal.blocks.goalBlock, names[1]);
  const rejected = goal.blocks.rejection === "goal";
  const best = outlookBestRecord(view.goalHorizon, goal.historical, goal.window.hasError);
  return (
    <OutlookQuestion
      labelledBy={`${inputId}-question`}
      question={
        <div className="grid min-w-0 gap-1">
          <h2 id={`${inputId}-question`} className="sr-only">
            目標の戦数で{names[0]}が上にいるには
          </h2>
          <div className={cn(contentText.heading, "flex flex-wrap items-center gap-x-2 gap-y-1")}>
            <label htmlFor={inputId} className="sr-only">
              目標の戦数
            </label>
            <span className="w-18">
              <InputControl
                id={inputId}
                inputMode="numeric"
                textAlign="end"
                density="compact"
                invalid={invalid}
                aria-describedby={invalid ? `${inputId}-error` : undefined}
                value={view.goalHorizonText}
                onChange={(event) => {
                  setValidateBlank(false);
                  goal.changeHorizon(event.target.value);
                }}
                onBlur={() => setValidateBlank(true)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === "Enter") setValidateBlank(true);
                  if (event.key === "Escape") {
                    setValidateBlank(false);
                    goal.changeHorizon(String(view.goalHorizon));
                  }
                }}
              />
            </span>
            <span>
              戦後{answer.ahead ? "も" : "に"}、{names[0]}が
              {answer.ahead ? "先行を保つには" : "上回るには"}
            </span>
          </div>
          {invalid ? (
            <p id={`${inputId}-error`} className={fieldText.error} role="alert">
              1〜1000の整数で入力してください（{view.goalHorizon}戦後で表示中）。
            </p>
          ) : null}
        </div>
      }
      answer={
        <>
          <p ref={answerRef} tabIndex={-1} className={cn(contentText.primary, "tabular-nums")}>
            {answer.answer}
          </p>
          {answer.apply ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={goal.blocks.goalBlock !== null}
              aria-describedby={block ? blockId : undefined}
              onClick={() => {
                if (!answer.apply) return;
                goal.apply(answer.apply.hundredths);
                // The action disappears once the goal is met; the answer it changed keeps focus.
                answerRef.current?.focus({ preventScroll: true });
              }}
            >
              {answer.apply.label}
            </Button>
          ) : null}
        </>
      }
      support={
        <>
          <p className={cn(contentText.supporting, "tabular-nums")}>
            {[answer.premise, answer.margin, best].filter(Boolean).join(" ・ ")}
          </p>
          {goal.window.hasError ? (
            <p className={cn(contentText.supporting, "flex flex-wrap items-center gap-2")}>
              自己ベストを取得できません。
              <Button
                size="sm"
                variant="quiet"
                pending={goal.window.refreshing}
                onClick={() => void goal.window.retry()}
              >
                再読み込み
              </Button>
            </p>
          ) : null}
          {answer.apply && (block || rejected) ? (
            <p id={blockId} className={contentText.supporting} role="status">
              {rejected
                ? "条件が変わりました。必要な平均を確かめて、もう一度試してください。"
                : block}
            </p>
          ) : null}
        </>
      }
      chart={
        <OutlookNeedLineChart
          names={names}
          memberIds={memberIds}
          cumulative={cumulative}
          pair={[view.focus, view.rival]}
          origin={[view.originFocus, view.originRival]}
          range={range}
          goalHorizon={view.goalHorizon}
          marker={trendMarker}
          ariaLabel={`${names[0]}が${names[1]}より上にいるのに必要なこれからの平均。目標${view.goalHorizon}戦後。`}
        />
      }
      notes={
        <>
          {view.goalHorizon > range ? (
            <p className={contentText.supporting}>
              目標の{view.goalHorizon}戦後は図の範囲より先です。数値は詳細で確認できます。
            </p>
          ) : null}
          <p className={contentText.supporting}>見直す観点：{answer.perspectives.join("・")}</p>
          <OutlookGoalExamples
            summary={summary}
            focusMemberId={memberIds[0]}
            names={names}
            view={view}
            blocks={goal.blocks}
            required={answer.required}
            expected={goal.expected}
            links={
              <>
                <LinkButton size="sm" variant="quiet" to={reviewHref}>
                  {names[0]}の行動仮説を見る
                </LinkButton>
                <LinkButton size="sm" variant="quiet" to={matchHref}>
                  {matchLabel}
                </LinkButton>
              </>
            }
          />
        </>
      }
    />
  );
}
