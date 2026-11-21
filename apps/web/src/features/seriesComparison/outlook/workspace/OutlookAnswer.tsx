import { useId, useState } from "react";
import type { Ref } from "react";

import {
  areDistributionsCompatible,
  formatRational,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  CumulativePair,
  RankDistribution,
} from "@/features/seriesComparison/outlook/calculation";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/outlookEditing";
import {
  compareOutlookOutcomes,
  outlookOutcome,
} from "@/features/seriesComparison/outlook/outlookOutcome";
import type { OutlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import type { buildOutlookOutcomeView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { useOutlookGoal } from "@/features/seriesComparison/outlook/useOutlookGoal";
import {
  useOutlookGoalHorizon,
  useOutlookResultView,
} from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import {
  OutlookExampleList,
  OutlookExampleToggle,
} from "@/features/seriesComparison/outlook/workspace/OutlookExampleList";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { InputControl } from "@/shared/ui/forms/Control";
import { contentText, fieldText } from "@/shared/ui/typography";

type NextOutcomes = ReturnType<typeof buildOutlookOutcomeView>["nextOutcomes"];
type GoalModel = ReturnType<typeof useOutlookGoal>;

/** The page's anchor: what happens if both future means hold, and how it differs from a kept one. */
export function OutlookConclusion({
  ref,
  cumulative,
  names,
  outcome,
  eventHorizon,
  nextOutcomes,
  onShowHorizon,
}: {
  ref?: Ref<HTMLElement>;
  cumulative: CumulativePair;
  names: readonly [string, string];
  outcome: OutlookOutcome;
  eventHorizon: number | null;
  nextOutcomes: NextOutcomes;
  onShowHorizon: (horizon: number) => void;
}) {
  const headingId = useId();
  const view = useOutlookResultView();
  const pinned =
    view.pinnedFocus && view.pinnedRival ? ([view.pinnedFocus, view.pinnedRival] as const) : null;
  const current = [view.focus, view.rival] as const;
  return (
    <section ref={ref} className="grid min-w-0 gap-1" aria-labelledby={headingId}>
      <h2 id={headingId} className={contentText.supporting}>
        {pinned ? "残した条件と比べると" : "この平均が続くと"}
      </h2>
      <p className={cn(contentText.primary, "text-pretty")} aria-live="polite">
        {pinned ? compareOutlookOutcomes(cumulative, pinned, current, names) : outcome.headline}
      </p>
      {pinned ? (
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          {[
            { label: "残した条件", result: outlookOutcome(cumulative, pinned, names) },
            { label: "今の条件", result: outcome },
          ].map(({ label, result }) => (
            <div key={label} className="contents">
              <dt className={cn(contentText.supporting, "pt-0.5")}>{label}</dt>
              <dd className={contentText.body}>
                {result.headline}
                {result.detail ? (
                  <span className={cn(contentText.supporting, "ml-2")}>{result.detail}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={cn(contentText.supporting, "flex min-h-5 flex-wrap items-center gap-x-2")}>
          {outcome.detail ? <span>{outcome.detail}</span> : null}
          {eventHorizon !== null ? (
            <button
              type="button"
              className="rounded-xs text-action underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
              onClick={() => onShowHorizon(eventHorizon)}
            >
              {eventHorizon}戦後の{eventHorizon > 200 ? "数値" : "推移"}を見る
            </button>
          ) : null}
        </p>
      )}
      {nextOutcomes.length ? (
        <p className={contentText.supporting}>
          次戦で動く組み合わせ：
          {nextOutcomes
            .map(
              (next) =>
                `${names[0]}${next.focusRank}位・${names[1]}${next.rivalRank}位なら${next.relation === "tied" ? "同率" : `${next.relation === "ahead" ? names[0] : names[1]}が上`}`,
            )
            .join("、")}
        </p>
      ) : null}
    </section>
  );
}

/** The second question beside its chart: what it takes to be ahead at a chosen game count. */
export function OutlookGoalSummary({
  response,
  cumulative,
  names,
  memberIds,
  recent,
  goal,
  reviewHref,
  matchHref,
  seasonSelected,
}: {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  recent: readonly [RankDistribution, RankDistribution];
  goal: GoalModel;
  reviewHref: string;
  matchHref: string;
  seasonSelected: boolean;
}) {
  const headingId = useId();
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
        : `${names[1]}がこの成績なら届きません`
      : `平均 ${(maximum / 100).toFixed(2)}位以下`;
  const improvement = goal.recentWithinMean
    ? areDistributionsCompatible(recent[0], goal.rival)
      ? `直近20戦の成績で${ahead ? "先行を保てる" : "届く"}`
      : "平均は条件内・内訳の見直しが必要"
    : goal.improvement !== null && goal.improvement.numerator > 0n
      ? `直近20戦から ${formatRational(goal.improvement, 2)} の改善が必要`
      : null;
  const best = goal.historical?.window
    ? `連続${goal.goalHorizon}戦の自己ベスト ${goal.historical.window.averageRank.toFixed(2)}位（${formatDateOnly(goal.historical.window.period.startedAt)}〜${formatDateOnly(goal.historical.window.period.endedAt)}）`
    : goal.historical?.status === "insufficient"
      ? `連続${goal.goalHorizon}戦の自己ベスト：作品の実績${response.source.titleMatchCount}戦では不足`
      : goal.window.hasError
        ? null
        : "自己ベストを読み込み中";
  return (
    <section
      className="grid min-w-0 gap-1.5"
      aria-labelledby={headingId}
      data-outlook-preserve-draft
    >
      <h2 id={headingId} className="sr-only">
        目標
      </h2>
      <div
        className={cn(
          contentText.body,
          "flex flex-wrap items-center gap-x-2 gap-y-1 text-text-primary",
        )}
      >
        <label htmlFor={inputId} className={contentText.supporting}>
          目標
        </label>
        <div className="w-20">
          <InputControl
            id={inputId}
            inputMode="numeric"
            textAlign="end"
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
        </div>
        <span>
          戦後{ahead ? "も" : "に"}、{names[0]}が{ahead ? "先行を保つには" : "上回るには"}
        </span>
      </div>
      {invalid ? (
        <p id={`${inputId}-error`} className={fieldText.error} role="alert">
          1〜1000の整数で入力してください（{horizon.view.horizon}戦後で表示しています）。
        </p>
      ) : null}
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-base/6 font-emphasis text-text-primary tabular-nums">{answer}</p>
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
      <p className={cn(contentText.supporting, "tabular-nums")}>
        {opponentPending
          ? `${names[1]}の入力を反映するか取り消すと、この平均を試せます。`
          : [
              improvement,
              reaches && maximum !== null
                ? `必要な平均は ${(maximum / 100).toFixed(2)}位以下`
                : null,
              best,
            ]
              .filter(Boolean)
              .join(" ・ ")}
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
      <div className="-ml-2">
        <OutlookExampleToggle
          response={response}
          memberId={memberIds[0]}
          role={0}
          controlsId={examplesId}
          label="目標に届く実績"
          condition={{ kind: "goal", cumulative, required }}
          openState={{ open: examplesOpen, setOpen: setExamplesOpen }}
        />
      </div>
      <OutlookExampleList
        id={examplesId}
        response={response}
        memberId={memberIds[0]}
        memberName={names[0]}
        condition={{ kind: "goal", cumulative, required }}
        openState={{ open: examplesOpen, setOpen: setExamplesOpen }}
      />
      <p className="flex flex-wrap items-center gap-x-1">
        <span className={cn(contentText.supporting, "mr-1")}>{goal.reviewHeading}</span>
        <span className="-ml-1 inline-flex flex-wrap items-center">
          <LinkButton size="sm" variant="quiet" to={reviewHref}>
            {names[0]}の行動仮説
          </LinkButton>
          <LinkButton size="sm" variant="quiet" to={matchHref}>
            {seasonSelected ? "このシーズンの確定戦績" : "この作品の確定戦績"}
          </LinkButton>
        </span>
      </p>
    </section>
  );
}
