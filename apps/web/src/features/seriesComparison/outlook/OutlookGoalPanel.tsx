import { Undo2 } from "lucide-react";
import { useId, useMemo } from "react";
import type { ReactNode } from "react";

import {
  areDistributionsCompatible,
  compareRationals,
  countsFromMean,
  distributionMean,
  distributionsEqual,
  formatRational,
  rational,
  requiredMean,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair, RankDistribution } from "@/features/seriesComparison/model/outlook";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import { OutlookPastExamples } from "@/features/seriesComparison/outlook/OutlookReferences";
import {
  applyOutlookDistribution,
  finishOutlookGesture,
  undoOutlook,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function OutlookGoalPanel({
  response,
  cumulative,
  session,
  names,
  memberIds,
  recent,
  change,
  horizonControl,
  opponentEditor,
  onUsePerformance,
  reviewLinks,
}: {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  session: OutlookSession;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  recent: readonly [RankDistribution, RankDistribution];
  change: (update: (current: OutlookSession) => OutlookSession) => void;
  horizonControl: ReactNode;
  opponentEditor: ReactNode;
  onUsePerformance: () => void;
  reviewLinks?: ReactNode;
}) {
  const headingId = useId();
  const conditionId = useId();
  const { goalHorizon } = session;
  const valid = parseOutlookHorizon(session.goalHorizonText) === goalHorizon;
  const focus = session.entries[0].distribution;
  const rival = session.entries[1].distribution;
  const required = useMemo(
    () => requiredMean(cumulative, rival, goalHorizon),
    [cumulative, rival, goalHorizon],
  );
  const maximum = required.maximumHundredths;
  const ahead = cumulative.focusRankSum < cumulative.rivalRankSum;
  const reaches =
    compareRationals(distributionMean(focus), required.threshold) < 0 &&
    areDistributionsCompatible(focus, rival);
  const recentMean = distributionMean(recent[0]);
  const recentWithinMean = compareRationals(recentMean, required.threshold) < 0;
  const improvement =
    maximum === null ? null : subtractRationals(recentMean, rational(BigInt(maximum), 100n));
  const { window } = useOutlookResource(response, memberIds[0], goalHorizon, false);
  const historical =
    goalHorizon === 50 || goalHorizon === 100
      ? response.bestWindows.find(
          (item) => item.memberId === memberIds[0] && item.windowSize === goalHorizon,
        )
      : window.data;

  const usePerformance = () => {
    if (!valid || (!reaches && maximum === null)) return;
    let accepted = false;
    // The session store applies this update synchronously, before changing the visible task.
    change((current) => {
      if (
        current.artifactId !== response.artifact.artifactId ||
        current.key !== session.key ||
        parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon
      )
        return current;
      const latest = requiredMean(cumulative, current.entries[1].distribution, current.goalHorizon);
      if (
        current.goalHorizon !== goalHorizon ||
        !distributionsEqual(current.entries[1].distribution, rival) ||
        latest.maximumHundredths !== maximum
      )
        return {
          ...current,
          notice: "条件が変わりました。必要な平均を確認して、もう一度試してください。",
        };
      const currentFocus = current.entries[0].distribution;
      if (
        compareRationals(distributionMean(currentFocus), latest.threshold) < 0 &&
        areDistributionsCompatible(currentFocus, current.entries[1].distribution)
      ) {
        accepted = true;
        return updateOutlookEntry(current, 0, { meanDraft: undefined, error: undefined });
      }
      if (latest.maximumHundredths === null) return current;
      const distribution = countsFromMean(
        latest.maximumHundredths,
        current.entries[1].distribution,
        currentFocus,
      );
      if (!distribution) return current;
      accepted = true;
      return applyOutlookDistribution(finishOutlookGesture(current), 0, distribution, {
        kind: "average",
      });
    });
    if (accepted) onUsePerformance();
  };

  return (
    <section className="grid min-w-0 gap-6" aria-labelledby={headingId} data-outlook-preserve-draft>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={contentText.heading}>到達の条件</h2>
            <Button
              variant="quiet"
              size="sm"
              disabled={session.history.length === 0 && !session.gesture}
              icon={<Undo2 aria-hidden="true" className="size-4" />}
              onClick={() => change(undoOutlook)}
            >
              1つ戻す
            </Button>
          </div>
          {horizonControl}
          {opponentEditor}
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <div className={cn("grid gap-2", readableTextWidthClass)}>
            <h2 id={headingId} className={contentText.heading}>
              {goalHorizon}戦後{ahead ? "も" : "に"}
              {names[0]}が{ahead ? "先行を維持するには" : "上回るには"}
            </h2>
            <p className={cn(contentText.primary, "tabular-nums")}>
              {maximum === null
                ? reaches
                  ? `今の成績で${ahead ? "先行を維持できます" : "上回れます"}`
                  : required.kind === "precision-impossible"
                    ? "入力できる細かさでは指定できません"
                    : "相手がこの成績なら届きません"
                : `平均${(maximum / 100).toFixed(2)}位以下`}
            </p>
            <p id={conditionId} className={contentText.body}>
              {names[1]}が平均{outlookAverage(distributionMean(rival))}位を続ける条件です。
            </p>
            {reaches ? (
              <p className={contentText.body}>
                今の平均{outlookAverage(distributionMean(focus))}位で条件を満たしています。
              </p>
            ) : null}
          </div>
          <div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!valid || (!reaches && maximum === null)}
              aria-describedby={conditionId}
              onClick={usePerformance}
            >
              {reaches ? "今の成績で推移を見る" : "この成績で推移を見る"}
            </Button>
          </div>
          <FactList
            ariaLabel={`${names[0]}の目標と過去の成績`}
            columns={3}
            items={[
              {
                id: "recent",
                label: `直近${response.recent.matchCount}戦の平均`,
                value: `${outlookAverage(recentMean)}位`,
              },
              {
                id: "improvement",
                label: "直近から必要な改善",
                value: recentWithinMean
                  ? areDistributionsCompatible(recent[0], rival)
                    ? ahead
                      ? "直近の成績で維持できる"
                      : "直近の成績で届く"
                    : "平均は条件内・内訳の変更が必要"
                  : improvement !== null && improvement.numerator > 0n
                    ? `${formatRational(improvement, 2)}位の改善`
                    : "この条件では指定できません",
              },
              {
                id: "best",
                label: `作品内の連続${goalHorizon}戦の自己ベスト`,
                value: historical?.window ? (
                  <span className="grid gap-1">
                    <span>{historical.window.averageRank.toFixed(2)}位</span>
                    <span className={contentText.supporting}>
                      {formatDateOnly(historical.window.period.startedAt)}〜
                      {formatDateOnly(historical.window.period.endedAt)}
                    </span>
                  </span>
                ) : historical?.status === "insufficient" ? (
                  `作品の実績${response.source.titleMatchCount}戦では不足`
                ) : window.isError ? (
                  <div className="grid justify-items-start gap-1">
                    <span>過去実績を取得できません。</span>
                    <Button
                      size="sm"
                      variant="quiet"
                      pending={window.isFetching}
                      onClick={() => void window.refetch()}
                    >
                      過去実績を再読み込み
                    </Button>
                  </div>
                ) : (
                  "過去実績を読み込み中"
                ),
              },
            ]}
          />
        </div>
      </div>
      <OutlookPastExamples
        response={response}
        focusId={memberIds[0]}
        focusName={names[0]}
        cumulative={cumulative}
        required={required}
        session={session}
        change={change}
        onUsePerformance={onUsePerformance}
      />
      {reviewLinks}
    </section>
  );
}
