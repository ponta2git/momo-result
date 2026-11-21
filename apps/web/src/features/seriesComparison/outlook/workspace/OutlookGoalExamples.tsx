import { useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  RankDistribution,
  RequiredMean,
} from "@/features/seriesComparison/outlook/calculation";
import type {
  OutlookApplyView,
  OutlookResultView,
} from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookGoalExpectation } from "@/features/seriesComparison/outlook/outlookProposals";
import { useOutlookGoalExamples } from "@/features/seriesComparison/outlook/useOutlookExamples";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

function blockText(blocks: OutlookApplyView) {
  switch (blocks.exampleBlock) {
    case "gesture":
      return "平均順位の操作を終えると試せます。";
    case "pending":
      return "2人の入力を反映するか、取り消すと試せます。";
    case "invalid-goal":
      return "目標の戦数を1〜1000で入力すると試せます。";
    default:
      return null;
  }
}

/**
 * 「目標に届く実績」: the focus person's past 20 games that strictly meet the goal, read only
 * once opened, followed by the links that continue the review outside this view.
 */
export function OutlookGoalExamples({
  summary,
  focusMemberId,
  names,
  view,
  blocks,
  required,
  expected,
  links,
}: {
  summary: SeriesAnalysisOutlookSummary;
  focusMemberId: string;
  names: readonly [string, string];
  view: OutlookResultView;
  blocks: OutlookApplyView;
  required: RequiredMean;
  expected: OutlookGoalExpectation;
  links: ReactNode;
}) {
  const blockId = useId();
  const [open, setOpen] = useState(false);
  const rival: RankDistribution = view.rival;
  const { query, list, apply } = useOutlookGoalExamples({
    response: summary,
    focusMemberId,
    open,
    required,
    rival,
    expected,
  });
  const block = blockText(blocks);
  return (
    <div className="grid min-w-0 gap-1">
      <Disclosure summary="目標に届く実績" open={open} onOpenChange={setOpen} panelSpacing="sm">
        <div className="grid min-w-0 gap-3 pb-2">
          <p className={contentText.supporting}>
            {view.goalHorizon}戦続ければ上回れる、連続20戦の実績
          </p>
          {block || blocks.rejection === "example" ? (
            <p id={blockId} className={contentText.supporting} role="status">
              {blocks.rejection === "example"
                ? "条件が変わったため、この実績例を試せませんでした。"
                : block}
            </p>
          ) : null}
          {list.kind === "unreachable" ? (
            <p className={contentText.body}>
              {names[1]}がこの平均なら、どの成績でも{view.goalHorizon}戦後には上回れません。
            </p>
          ) : list.kind === "unread" ? (
            query.hasError ? null : (
              <p role="status" className={contentText.supporting}>
                実績を読み込み中
              </p>
            )
          ) : list.kind === "insufficient" ? (
            <p className={contentText.body}>
              作品の実績が20戦未満のため、連続20戦の例はありません。
            </p>
          ) : list.kind === "none" ? (
            <p className={contentText.body}>条件に合う20戦の実績がありません。</p>
          ) : list.kind === "incompatible" ? (
            <p className={contentText.body}>
              条件に合う実績はありますが、{names[1]}の今の指定と両立する例がありません。
            </p>
          ) : (
            <ul className="grid gap-3">
              {list.examples.map((example) => (
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
                        {example.rankCounts
                          .map((count, index) => `${index + 1}位${count}`)
                          .join("・")}
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
                    disabled={blocks.exampleBlock !== null}
                    aria-describedby={block ? blockId : undefined}
                    aria-label={`${names[0]}に平均${example.window.averageRank.toFixed(2)}位の実績を試す`}
                    onClick={() => apply(example)}
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
      </Disclosure>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{links}</div>
    </div>
  );
}
