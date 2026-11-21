import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  areDistributionsCompatible,
  distributionMean,
  distributionsEqual,
  formatRational,
  projectOutlook,
  rationalToNumber,
} from "@/features/seriesComparison/outlook/calculation";
import {
  outlookChartRange,
  parseOutlookHorizon,
} from "@/features/seriesComparison/outlook/outlookEditing";
import { outlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import { useOutlookGoal } from "@/features/seriesComparison/outlook/useOutlookGoal";
import { useOutlookPatterns } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import {
  useOutlookGoalHorizon,
  useOutlookWorkspace,
} from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import { needLineCrossing } from "@/features/seriesComparison/outlook/workspace/needLine";
import { OutlookAverageControl } from "@/features/seriesComparison/outlook/workspace/OutlookAverageControl";
import {
  OutlookExampleList,
  OutlookExampleToggle,
} from "@/features/seriesComparison/outlook/workspace/OutlookExampleList";
import { OutlookGapChart } from "@/features/seriesComparison/outlook/workspace/OutlookGapChart";
import { OutlookNeedLineChart } from "@/features/seriesComparison/outlook/workspace/OutlookNeedLineChart";
import {
  OutlookComparisonRow,
  OutlookDetails,
  useStickyWhenFits,
} from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceParts";
import type { OutlookWorkspaceProps } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceView";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { InputControl } from "@/shared/ui/forms/Control";
import { contentText, fieldText } from "@/shared/ui/typography";

const columnsClass = "lg:grid-cols-[minmax(18rem,21rem)_minmax(0,1fr)]";
/**
 * Both answers use the same block shape: question, answer, support, chart, notes. Side by side,
 * the shared rows put the two questions, the two answers and the two charts on one line each.
 */
const questionClass = "grid min-w-0 content-start gap-y-1 xl:row-span-5 xl:grid-rows-subgrid";
const chartRowClass = "mt-3";
const notesRowClass = "mt-1";

function monthRange(startedAt: string, endedAt: string) {
  const start = startedAt.slice(0, 7).replace("-", "/");
  const end = endedAt.slice(0, 7).replace("-", "/");
  if (start === end) return start;
  return start.slice(0, 4) === end.slice(0, 4) ? `${start}〜${end.slice(5)}` : `${start}〜${end}`;
}

/**
 * What is assumed on the left, the two questions on the right, each answered by one sentence and
 * one chart. Layout carries the reading order, so the text names only facts.
 */
export function OutlookWorkspace({
  summary,
  selection,
  onMemberChange,
  onPairChange,
}: OutlookWorkspaceProps) {
  const workspace = useOutlookWorkspace(summary, selection);
  const {
    view,
    memberIds,
    names,
    displayRoles,
    recent,
    cumulative,
    outcome,
    eventHorizon,
    projectionRows,
    nextOutcomes,
    reviewHref,
    matchHref,
  } = workspace;
  const goal = useOutlookGoal({ response: summary, cumulative, memberIds, recent });
  const range = outlookChartRange(Math.min(goal.goalHorizon, 200));
  const rangedView = useMemo(() => ({ ...view, chartRange: range }), [view, range]);
  const exampleLabel = useCallback(
    (index: number, tied: boolean) =>
      tied
        ? `展開例${index + 1}`
        : (["有利な例", "中間の例", "不利な例"][index] ?? `展開例${index + 1}`),
    [],
  );
  const patterns = useOutlookPatterns({
    active: true,
    response: summary,
    cumulative,
    view: rangedView,
    memberIds,
    marker: null,
    exampleLabel,
  });
  const left = useRef<HTMLElement>(null);
  const sticky = useStickyWhenFits(left);

  const now = projectionRows.find((row) => row.h === 0) ?? {
    h: 0,
    ...projectOutlook(cumulative, view.focus, view.rival, 0),
  };
  const recentGames = summary.recent.matchCount;
  const focusMean = rationalToNumber(distributionMean(view.focus));
  const rivalMean = rationalToNumber(distributionMean(view.rival));
  const crossingH = needLineCrossing(cumulative, focusMean, rivalMean);
  const crossingLabel =
    outcome.crossing.exactTie !== null && outcome.crossing.exactTie > 0n
      ? `${outcome.crossing.exactTie}戦後に同率`
      : eventHorizon !== null
        ? `${eventHorizon}戦後`
        : null;
  const sameAsRecent =
    distributionsEqual(view.focus, recent[0]) && distributionsEqual(view.rival, recent[1]);
  const conclusionNotes = [
    outcome.detail,
    sameAsRecent
      ? null
      : `直近${recentGames}戦のままなら：${outlookOutcome(cumulative, recent, names).headline}`,
  ].filter(Boolean);
  const beyond =
    outcome.eventHorizon !== null && outcome.eventHorizon > BigInt(range)
      ? outcome.eventHorizon
      : null;
  const examples = patterns.examples;
  const exampleNote = view.gesturing
    ? "展開例は操作を終えると更新します。"
    : !examples
      ? "この条件では展開例を作れません。"
      : examples.constantPerGameDifference
        ? "この内訳では、どの展開例も差は同じ推移です。"
        : `細い線は試合ごとのブレを入れた展開例です（${range}戦後の差の順。確率ではありません）。`;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <OutlookComparisonRow
        summary={summary}
        selection={selection}
        memberIds={memberIds}
        names={names}
        displayRoles={displayRoles}
        now={now}
        columnsClass={columnsClass}
        onMemberChange={onMemberChange}
        onPairChange={onPairChange}
      />
      {view.notice ? (
        <Notice presentation="bare" tone="info">
          {view.notice}
        </Notice>
      ) : null}
      <div
        className="sticky top-(--global-nav-height) z-(--z-sticky) -mx-4 border-b border-border bg-surface px-4 py-2 lg:hidden"
        aria-hidden="true"
      >
        <p className={contentText.supporting}>この平均が続くと</p>
        <p className={contentText.compactPrimary}>{outcome.headline}</p>
        <p className={contentText.supporting}>
          目標{goal.goalHorizon}戦後：
          {goal.reaches
            ? "今の平均で届く"
            : goal.maximum !== null
              ? `平均${(goal.maximum / 100).toFixed(2)}位以下`
              : "届かない条件"}
        </p>
      </div>
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-x-10 gap-y-8 lg:items-start lg:gap-y-10",
          columnsClass,
        )}
      >
        <section
          ref={left}
          aria-labelledby="outlook-assumptions"
          className={cn(
            "grid min-w-0 content-start gap-6",
            sticky && "lg:sticky lg:top-(--sticky-below-nav)",
          )}
        >
          <h2 id="outlook-assumptions" className={contentText.heading}>
            これからの平均順位
          </h2>
          {([0, 1] as const).map((role) => (
            <OutlookAverageControl
              key={memberIds[role]}
              response={summary}
              cumulative={cumulative}
              names={names}
              memberIds={memberIds}
              role={role}
              recent={recent[role]}
            />
          ))}
        </section>
        <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-10 xl:grid-cols-2">
          <section className={questionClass} aria-labelledby="outlook-question-trend">
            <h2
              id="outlook-question-trend"
              className={cn(contentText.heading, "flex items-center")}
            >
              この平均が続くと
            </h2>
            <p className={cn(contentText.primary, "text-pretty")} aria-live="polite">
              {outcome.headline}
            </p>
            <div className={cn(contentText.supporting, "grid content-start gap-1")}>
              <p className="min-h-4">{conclusionNotes.join(" ・ ")}</p>
              {nextOutcomes.length > 0 ? (
                <p>
                  次戦で動く組み合わせ：
                  {nextOutcomes
                    .map(
                      (next) =>
                        `${names[0]}${next.focusRank}位・${names[1]}${next.rivalRank}位なら${next.relation === "tied" ? "同率" : `${next.relation === "ahead" ? names[0] : names[1]}が上`}`,
                    )
                    .join("、")}
                </p>
              ) : null}
            </div>
            <div className={chartRowClass}>
              <OutlookGapChart
                names={names}
                memberIds={memberIds}
                patterns={patterns.patterns}
                range={range}
                crossing={
                  crossingH !== null && crossingLabel
                    ? { h: crossingH, label: crossingLabel }
                    : null
                }
                ariaLabel={`${names[0]}から見た総合平均の差の推移。${outcome.headline}。`}
              />
            </div>
            <div className={cn(contentText.supporting, notesRowClass, "grid content-start gap-1")}>
              <p role={view.gesturing ? "status" : undefined}>{exampleNote}</p>
              {beyond !== null ? (
                <p>順番が入れ替わるのは{String(beyond)}戦後で、図の範囲より先です。</p>
              ) : null}
            </div>
          </section>
          <GoalQuestion
            summary={summary}
            cumulative={cumulative}
            names={names}
            memberIds={memberIds}
            recent={recent}
            goal={goal}
            reviewHref={reviewHref}
            matchHref={matchHref}
            matchLabel={
              selection.seasonMasterId ? "このシーズンの確定戦績を見る" : "この作品の確定戦績を見る"
            }
            recentGames={recentGames}
            range={range}
            rivalMean={outlookAverage(distributionMean(view.rival))}
            chart={
              <OutlookNeedLineChart
                names={names}
                memberIds={memberIds}
                cumulative={cumulative}
                focus={view.focus}
                rival={view.rival}
                range={range}
                goal={{ horizon: goal.goalHorizon, label: "目標" }}
                crossingLabel={crossingLabel}
                ariaLabel={`${names[0]}が${names[1]}より上にいるのに必要なこれからの平均。目標${goal.goalHorizon}戦後。`}
              />
            }
          />
          <div className="xl:col-span-2">
            <OutlookDetails
              summary={summary}
              names={names}
              displayRoles={displayRoles}
              recent={recent}
              cumulative={cumulative}
              focus={view.focus}
              rival={view.rival}
              goalHorizon={goal.goalHorizon}
              exampleLabels={patterns.patterns.slice(1).map((pattern) => pattern.label)}
              exampleGapsAt={patterns.exampleGapsAt}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function GoalQuestion({
  summary,
  cumulative,
  names,
  memberIds,
  recent,
  goal,
  reviewHref,
  matchHref,
  matchLabel,
  recentGames,
  range,
  rivalMean,
  chart,
}: {
  summary: OutlookWorkspaceProps["summary"];
  cumulative: ReturnType<typeof useOutlookWorkspace>["cumulative"];
  names: readonly [string, string];
  memberIds: readonly [string, string];
  recent: ReturnType<typeof useOutlookWorkspace>["recent"];
  goal: ReturnType<typeof useOutlookGoal>;
  reviewHref: string;
  matchHref: string;
  matchLabel: string;
  recentGames: number;
  range: number;
  rivalMean: string;
  chart: ReactNode;
}) {
  const inputId = useId();
  const examplesId = useId();
  const horizon = useOutlookGoalHorizon();
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [validateBlank, setValidateBlank] = useState(false);
  const { valid, required, maximum, ahead, reaches, opponentPending, performanceMean } = goal;
  const blank = horizon.view.horizonText === "";
  const invalid =
    parseOutlookHorizon(horizon.view.horizonText) === undefined && (!blank || validateBlank);
  const answer = reaches
    ? `今の平均 ${performanceMean}位で${ahead ? "先行を保てます" : "上回れます"}`
    : maximum === null
      ? required.kind === "precision-impossible"
        ? "入力できる細かさでは指定できません"
        : `${names[1]}がこの平均なら届きません`
      : `平均 ${(maximum / 100).toFixed(2)}位以下`;
  const margin =
    reaches && maximum !== null
      ? `必要なのは ${(maximum / 100).toFixed(2)}位以下`
      : goal.recentWithinMean && !areDistributionsCompatible(recent[0], goal.rival)
        ? "平均は届くが内訳の見直しが必要"
        : goal.improvement !== null && goal.improvement.numerator > 0n
          ? `直近${recentGames}戦から${formatRational(goal.improvement, 2)}の改善`
          : null;
  const best = goal.historical?.window
    ? `連続${goal.goalHorizon}戦の自己ベスト ${goal.historical.window.averageRank.toFixed(2)}位（${monthRange(goal.historical.window.period.startedAt, goal.historical.window.period.endedAt)}）`
    : goal.historical?.status === "insufficient"
      ? `連続${goal.goalHorizon}戦の記録はまだありません`
      : goal.window.hasError
        ? null
        : "自己ベストを読み込み中";
  const condition = { kind: "goal" as const, cumulative, required };

  return (
    <section
      className={questionClass}
      aria-labelledby={`${inputId}-question`}
      data-outlook-preserve-draft
    >
      <div className="grid content-start gap-1">
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
              value={horizon.view.horizonText}
              onChange={(event) => {
                setValidateBlank(false);
                const next = parseOutlookHorizon(event.target.value);
                horizon.change({
                  horizonText: event.target.value,
                  horizon: next ?? horizon.view.horizon,
                });
              }}
              onBlur={() => setValidateBlank(true)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") setValidateBlank(true);
                if (event.key === "Escape") {
                  setValidateBlank(false);
                  horizon.change({
                    horizon: horizon.view.horizon,
                    horizonText: String(horizon.view.horizon),
                  });
                }
              }}
            />
          </span>
          <span>
            戦後{ahead ? "も" : "に"}、{names[0]}が{ahead ? "先行を保つには" : "上回るには"}
          </span>
        </div>
        {invalid ? (
          <p id={`${inputId}-error`} className={fieldText.error} role="alert">
            1〜1000の整数で入力してください（{horizon.view.horizon}戦後で表示中）。
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className={cn(contentText.primary, "tabular-nums")}>{answer}</p>
        {!reaches && maximum !== null ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!valid || opponentPending}
            onClick={() => goal.apply()}
          >
            {names[0]}を {(maximum / 100).toFixed(2)}位で試す
          </Button>
        ) : null}
      </div>
      <div className={cn(contentText.supporting, "grid content-start gap-1 tabular-nums")}>
        <p>
          {opponentPending
            ? `${names[1]}の入力を反映すると、この平均を試せます。`
            : [`${names[1]}が${rivalMean}位を続ける前提`, margin, best]
                .filter(Boolean)
                .join(" ・ ")}
        </p>
        {goal.window.hasError ? (
          <p className="flex flex-wrap items-center gap-2">
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
      </div>
      <div className={chartRowClass}>{chart}</div>
      <div className={cn(notesRowClass, "grid content-start gap-2")}>
        {goal.goalHorizon > range ? (
          <p className={contentText.supporting}>
            目標の{goal.goalHorizon}戦後は図の範囲より先です。数値は詳細で確認できます。
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <OutlookExampleToggle
            response={summary}
            memberId={memberIds[0]}
            role={0}
            controlsId={examplesId}
            label="目標に届く実績"
            condition={condition}
            openState={{ open: examplesOpen, setOpen: setExamplesOpen }}
          />
          <LinkButton size="sm" variant="quiet" to={reviewHref}>
            {goal.reviewHeading}（{names[0]}の行動仮説）
          </LinkButton>
          <LinkButton size="sm" variant="quiet" to={matchHref}>
            {matchLabel}
          </LinkButton>
        </div>
        <OutlookExampleList
          id={examplesId}
          response={summary}
          memberId={memberIds[0]}
          memberName={names[0]}
          condition={condition}
          openState={{ open: examplesOpen, setOpen: setExamplesOpen }}
        />
      </div>
    </section>
  );
}
