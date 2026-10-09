import { useMemo } from "react";

import {
  areDistributionsCompatible,
  compareRationals,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  requiredMean,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair, RequiredMean } from "@/features/seriesComparison/model/outlook";
import { parseOutlookHorizon } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import {
  applyOutlookDistribution,
  finishOutlookGesture,
} from "@/features/seriesComparison/outlook/outlookSession";
import type { OutlookSession } from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookResource } from "@/features/seriesComparison/outlook/useOutlookResource";
import type {
  SeriesAnalysisOutlookExamples,
  SeriesAnalysisOutlookSummary,
} from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";
import { ContentWithActions } from "@/shared/ui/layout/ContentWithActions";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function OutlookPastExamples({
  response,
  focusId,
  focusName,
  cumulative,
  required,
  session,
  change,
  onUsePerformance,
  pendingDescriptionId,
}: {
  response: SeriesAnalysisOutlookSummary;
  focusId: string;
  focusName: string;
  cumulative: CumulativePair;
  required: RequiredMean;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
  onUsePerformance?: (() => void) | undefined;
  pendingDescriptionId?: string | undefined;
}) {
  const { examples: query } = useOutlookResource(
    response,
    focusId,
    undefined,
    session.examplesOpen,
  );
  const rival = session.entries[1].distribution;
  const opponentPending =
    session.entries[1].meanDraft !== undefined ||
    session.entries[1].error !== undefined ||
    Boolean(session.gesture);
  const { examples, hasQualifying } = useMemo(() => {
    const selected: SeriesAnalysisOutlookExamples["examples"]["types"] = [];
    let hasMatchingMean = false;
    if (session.examplesOpen && query.data) {
      for (const example of query.data.examples.types) {
        const distribution = distributionFromCounts(example.rankCounts);
        if (compareRationals(distributionMean(distribution), required.threshold) >= 0) continue;
        hasMatchingMean = true;
        if (areDistributionsCompatible(distribution, rival)) selected.push(example);
        if (selected.length === 3) break;
      }
    }
    return { examples: selected, hasQualifying: hasMatchingMean };
  }, [query.data, session.examplesOpen, required.threshold, rival]);
  return (
    <Disclosure
      ariaLabel={`${focusName}の過去の成績例`}
      summary={`${focusName}の過去の成績例`}
      open={session.examplesOpen}
      onOpenChange={(open) => change((current) => ({ ...current, examplesOpen: open }))}
      triggerLayout="flush-horizontal"
      panelSpacing="sm"
    >
      <div className="grid min-w-0 gap-4">
        {query.data === undefined ? (
          query.isError ? null : (
            <p role="status" className={contentText.supporting}>
              成績例を読み込み中
            </p>
          )
        ) : query.data.examples.status === "insufficient" ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            作品の実績が20戦未満のため、連続20戦の例はありません。
          </p>
        ) : examples.length === 0 ? (
          <p className={cn(contentText.body, readableTextWidthClass)}>
            {hasQualifying
              ? "必要な平均を満たす実績はありますが、相手の指定と両立する例がありません。"
              : "必要な平均を満たす20戦の実績例がありません。"}{" "}
          </p>
        ) : (
          <div className="grid gap-4">
            <p className={cn(contentText.body, readableTextWidthClass)}>
              過去の連続20戦の成績から、{session.goalHorizon}戦続けると上回れる例を選んでいます。
            </p>
            <ul className="grid gap-4">
              {examples.map((example) => (
                <li key={example.rankCounts.join(":")}>
                  <ContentWithActions
                    actions={
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          opponentPending ||
                          parseOutlookHorizon(session.goalHorizonText) !== session.goalHorizon
                        }
                        aria-describedby={opponentPending ? pendingDescriptionId : undefined}
                        onClick={() => {
                          let accepted = false;
                          change((current) => {
                            if (
                              current.artifactId !== response.artifact.artifactId ||
                              current.key !== session.key ||
                              current.entries[1].meanDraft !== undefined ||
                              current.entries[1].error !== undefined ||
                              current.gesture !== undefined ||
                              parseOutlookHorizon(current.goalHorizonText) !== current.goalHorizon
                            )
                              return current;
                            if (
                              current.goalHorizon !== session.goalHorizon ||
                              !distributionsEqual(current.entries[1].distribution, rival)
                            )
                              return {
                                ...current,
                                notice:
                                  "条件が変わりました。成績例を確認して、もう一度試してください。",
                              };
                            const distribution = distributionFromCounts(example.rankCounts);
                            const latest = requiredMean(
                              cumulative,
                              current.entries[1].distribution,
                              current.goalHorizon,
                            );
                            if (
                              compareRationals(distributionMean(distribution), latest.threshold) >=
                                0 ||
                              !areDistributionsCompatible(
                                distribution,
                                current.entries[1].distribution,
                              )
                            )
                              return {
                                ...current,
                                notice: "条件が変わったため、この実績例を適用できません。",
                              };
                            accepted = true;
                            return applyOutlookDistribution(
                              finishOutlookGesture(current),
                              0,
                              distribution,
                              {
                                kind: "example",
                                artifactId: current.artifactId,
                                matchCount: 20,
                                period: example.window.period,
                              },
                            );
                          });
                          if (accepted) onUsePerformance?.();
                        }}
                      >
                        この成績を試す
                      </Button>
                    }
                  >
                    <div className="grid gap-1">
                      <p className={contentText.compactPrimary}>
                        {example.window.averageRank.toFixed(2)}位
                      </p>
                      <p className={contentText.body}>
                        {example.rankCounts
                          .map((count, index) => `${index + 1}位 ${count}回`)
                          .join(" / ")}
                      </p>
                      <p className={contentText.supporting}>
                        {formatDateOnly(example.window.period.startedAt)}〜
                        {formatDateOnly(example.window.period.endedAt)}
                      </p>
                    </div>
                  </ContentWithActions>
                </li>
              ))}
            </ul>
          </div>
        )}
        {query.isError ? (
          <Notice
            presentation="bare"
            tone={query.data ? "warning" : "danger"}
            action={
              <Button
                size="sm"
                variant="secondary"
                pending={query.isFetching}
                onClick={() => void query.refetch()}
              >
                成績例を再読み込み
              </Button>
            }
          >
            {query.data
              ? "過去の成績例を再取得できません。取得済みの結果を表示しています。"
              : "過去の成績例を取得できません。試算は続けられます。"}
          </Notice>
        ) : null}
      </div>
    </Disclosure>
  );
}
