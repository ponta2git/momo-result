import { useId } from "react";

import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import { useOutlookReferencesModel } from "@/features/seriesComparison/outlook/useOutlookReferencesModel";
import type { ExampleCondition } from "@/features/seriesComparison/outlook/useOutlookReferencesModel";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
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
  memberId,
  memberName,
  condition,
}: {
  response: SeriesAnalysisOutlookSummary;
  memberId: string;
  memberName: string;
  condition: ExampleCondition;
}) {
  const pendingId = useId();
  const model = useOutlookReferencesModel(response, memberId, condition);
  const { open, role, targetMean, pending, invalidGoal, examples, hasQualifying, query } = model;
  const pendingDescriptionId =
    condition.kind === "goal" ? condition.pendingDescriptionId : pendingId;
  return (
    <div className={cn("min-w-0", readableTextWidthClass)}>
      <Disclosure
        ariaLabel={`${memberName}の過去の成績例`}
        summary={`${memberName}の過去の成績例`}
        open={open}
        onOpenChange={model.setOpen}
        panelPadding="sm"
      >
        <div className="grid min-w-0 gap-4">
          {condition.kind === "mean" ? (
            <p className={cn(contentText.body, readableTextWidthClass)}>
              過去の連続20戦から、平均{outlookAverage(targetMean)}位{role === 0 ? "以下" : "以上"}
              の例を選んでいます。
              {model.hasDraft ? "入力途中の値は使わず、反映済みの平均で確認しています。" : null}
            </p>
          ) : null}
          {condition.kind === "mean" && pending ? (
            <p id={pendingId} className={contentText.supporting}>
              {model.pendingMessage}
            </p>
          ) : null}
          {query.data === undefined ? (
            query.hasError ? null : (
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
                ? `${condition.kind === "goal" ? "必要な平均" : "指定した平均"}を満たす実績はありますが、${role === 0 ? "相手の指定" : "注目する人の成績"}と両立する例がありません。`
                : condition.kind === "goal"
                  ? "必要な平均を満たす20戦の実績例がありません。"
                  : "指定した平均を満たす20戦の実績例がありません。"}
            </p>
          ) : (
            <div className="grid gap-4">
              {condition.kind === "goal" ? (
                <p className={cn(contentText.body, readableTextWidthClass)}>
                  過去の連続20戦の成績から、{model.goalHorizon}
                  戦続けると上回れる例を選んでいます。
                </p>
              ) : null}
              <ul className="grid gap-4">
                {examples.map((example) => (
                  <li key={example.rankCounts.join(":")}>
                    <ContentWithActions
                      actions={
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || invalidGoal}
                          aria-describedby={pending ? pendingDescriptionId : undefined}
                          onClick={() => model.apply(example)}
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
          {query.hasError ? (
            <Notice
              presentation="bare"
              tone={query.data ? "warning" : "danger"}
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  pending={query.refreshing}
                  onClick={() => void query.retry()}
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
    </div>
  );
}
