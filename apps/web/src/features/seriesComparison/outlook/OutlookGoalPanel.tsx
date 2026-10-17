import { useId } from "react";
import type { ReactNode } from "react";

import {
  areDistributionsCompatible,
  distributionMean,
  formatRational,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair, RankDistribution } from "@/features/seriesComparison/model/outlook";
import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import { OutlookPastExamples } from "@/features/seriesComparison/outlook/OutlookReferences";
import { OutlookUndoButton } from "@/features/seriesComparison/outlook/OutlookScenarioComparison";
import { useOutlookGoalModel } from "@/features/seriesComparison/outlook/useOutlookGoalModel";
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
  names,
  memberIds,
  recent,
  horizonControl,
  opponentEditor,
  onUsePerformance,
  reviewLinks,
}: {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  recent: readonly [RankDistribution, RankDistribution];
  horizonControl: ReactNode;
  opponentEditor: ReactNode;
  onUsePerformance: () => void;
  reviewLinks?: ReactNode;
}) {
  const headingId = useId();
  const conditionId = useId();
  const pendingId = useId();
  const model = useOutlookGoalModel({ response, cumulative, memberIds, recent });
  const {
    goalHorizon,
    valid,
    required,
    maximum,
    ahead,
    reaches,
    opponentPending,
    performanceMean,
    recentMean,
    recentWithinMean,
    improvement,
    rival,
    reviewHeading,
    historical,
    window,
  } = model;
  return (
    <section className="grid min-w-0 gap-6" aria-labelledby={headingId} data-outlook-preserve-draft>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={contentText.heading}>目標と相手の成績</h2>
            <OutlookUndoButton />
          </div>
          {horizonControl}
          {opponentEditor}
          <OutlookPastExamples
            response={response}
            memberId={memberIds[1]}
            memberName={names[1]}
            condition={{ kind: "mean", role: 1 }}
          />
        </div>
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <div className={cn("grid gap-2", readableTextWidthClass)}>
            <h2 id={headingId} className={contentText.heading}>
              {goalHorizon}戦後{ahead ? "も" : "に"}
              {names[0]}が{ahead ? "先行を維持するには" : "上回るには"}
            </h2>
            <p className={cn(contentText.primary, "tabular-nums")}>
              {reaches
                ? `今の平均${performanceMean}位で${ahead ? "維持できます" : "上回れます"}`
                : maximum === null
                  ? required.kind === "precision-impossible"
                    ? "入力できる細かさでは指定できません"
                    : "相手がこの成績なら届きません"
                  : `平均${(maximum / 100).toFixed(2)}位以下`}
            </p>
            {reaches && maximum !== null ? (
              <p className={contentText.supporting}>
                必要な平均は{(maximum / 100).toFixed(2)}位以下。
              </p>
            ) : null}
            <p id={conditionId} className={contentText.body}>
              {names[1]}が平均{outlookAverage(distributionMean(rival))}位を続ける条件です。
            </p>
          </div>
          <div className="grid justify-items-start gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!valid || opponentPending || (!reaches && maximum === null)}
              aria-describedby={opponentPending ? `${conditionId} ${pendingId}` : conditionId}
              onClick={() => {
                if (model.apply()) onUsePerformance();
              }}
            >
              {performanceMean === undefined
                ? "推移を見る"
                : `平均${performanceMean}位で推移を見る`}
            </Button>
            {opponentPending ? (
              <p id={pendingId} className={contentText.supporting}>
                {names[1]}の入力を反映するか、取り消してください。
              </p>
            ) : null}
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
                ) : window.hasError ? (
                  <div className="grid justify-items-start gap-1">
                    <span>過去実績を取得できません。</span>
                    <Button
                      size="sm"
                      variant="quiet"
                      pending={window.refreshing}
                      onClick={() => void window.retry()}
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
          <OutlookPastExamples
            response={response}
            memberId={memberIds[0]}
            memberName={names[0]}
            condition={{
              kind: "goal",
              cumulative,
              required,
              onUsePerformance,
              pendingDescriptionId: opponentPending ? pendingId : undefined,
            }}
          />
        </div>
      </div>
      {reviewLinks ? (
        <div className="grid gap-2">
          <h3 className={contentText.heading}>{reviewHeading}</h3>
          {reviewLinks}
        </div>
      ) : null}
    </section>
  );
}
