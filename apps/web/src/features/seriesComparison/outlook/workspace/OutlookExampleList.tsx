import { ChevronDown } from "lucide-react";
import { useId } from "react";

import { outlookAverage } from "@/features/seriesComparison/outlook/outlookPresentation";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookExamples } from "@/features/seriesComparison/outlook/useOutlookExamples";
import type { OutlookExampleCondition } from "@/features/seriesComparison/outlook/useOutlookExamples";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

type OpenState = { open: boolean; setOpen: (open: boolean) => void };

/** Opens the person's 20-game examples in place, below the control it would change. */
export function OutlookExampleToggle({
  response,
  memberId,
  role,
  controlsId,
  label = "実績から選ぶ",
  condition,
  openState,
}: {
  response: SeriesAnalysisOutlookSummary;
  memberId: string;
  role: OutlookRole;
  controlsId: string;
  label?: string;
  condition?: OutlookExampleCondition;
  openState?: OpenState;
}) {
  const examples = useOutlookExamples(
    response,
    memberId,
    condition ?? { kind: "mean", role },
    openState,
  );
  return (
    <Button
      size="sm"
      variant="quiet"
      aria-expanded={examples.open}
      aria-controls={controlsId}
      icon={
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            examples.open && "rotate-180",
          )}
        />
      }
      onClick={() => examples.setOpen(!examples.open)}
    >
      {label}
    </Button>
  );
}

export function OutlookExampleList({
  id,
  response,
  memberId,
  memberName,
  condition,
  openState,
}: {
  id: string;
  response: SeriesAnalysisOutlookSummary;
  memberId: string;
  memberName: string;
  condition: OutlookExampleCondition;
  openState?: OpenState;
}) {
  const pendingId = useId();
  const model = useOutlookExamples(response, memberId, condition, openState);
  const { open, role, targetMean, pending, invalidGoal, examples, hasQualifying, query } = model;
  if (!open) return <div id={id} hidden />;
  const criterion =
    condition.kind === "goal"
      ? `${model.goalHorizon}戦続ければ上回れる、連続20戦の実績`
      : `平均 ${outlookAverage(targetMean)}位${role === 0 ? "以下" : "以上"}だった連続20戦の実績`;
  return (
    <div id={id} className="grid min-w-0 gap-3 border-l-2 border-border pl-3">
      <p className={contentText.supporting}>
        {criterion}
        {condition.kind === "mean" && model.hasDraft
          ? "（入力途中の値ではなく、反映済みの平均で探しています）"
          : ""}
      </p>
      {pending ? (
        <p id={pendingId} className={contentText.supporting}>
          {model.pendingMessage}
        </p>
      ) : null}
      {query.data === undefined ? (
        query.hasError ? null : (
          <p role="status" className={contentText.supporting}>
            実績を読み込み中
          </p>
        )
      ) : query.data.examples.status === "insufficient" ? (
        <p className={contentText.body}>作品の実績が20戦未満のため、連続20戦の例はありません。</p>
      ) : examples.length === 0 ? (
        <p className={contentText.body}>
          {hasQualifying
            ? `条件に合う実績はありますが、${role === 0 ? "相手の指定" : "注目する人の成績"}と両立する例がありません。`
            : "条件に合う20戦の実績がありません。"}
        </p>
      ) : (
        <ul className="grid gap-3">
          {examples.map((example) => (
            <li
              key={example.rankCounts.join(":")}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
            >
              <div className="grid min-w-0 gap-0.5">
                <p className={cn(contentText.body, "tabular-nums")}>
                  <span className="font-emphasis text-text-primary">
                    {example.window.averageRank.toFixed(2)}位
                  </span>
                  <span className="ml-2">
                    {example.rankCounts.map((count, index) => `${index + 1}位${count}`).join("・")}
                  </span>
                </p>
                <p className={cn(contentText.supporting, "tabular-nums")}>
                  {formatDateOnly(example.window.period.startedAt)}〜
                  {formatDateOnly(example.window.period.endedAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || invalidGoal}
                aria-describedby={pending ? pendingId : undefined}
                aria-label={`${memberName}に平均${example.window.averageRank.toFixed(2)}位の実績を試す`}
                onClick={() => model.apply(example)}
              >
                試す
              </Button>
            </li>
          ))}
        </ul>
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
              再読み込み
            </Button>
          }
        >
          {query.data
            ? "実績を再取得できません。取得済みの結果を表示しています。"
            : "実績を取得できません。試算は続けられます。"}
        </Notice>
      ) : null}
    </div>
  );
}
