import { useMemo, useRef } from "react";

import {
  outlookGoalAnswer,
  outlookTrendAnswer,
} from "@/features/seriesComparison/outlook/outlookAnswers";
import { outlookChartRange } from "@/features/seriesComparison/outlook/outlookEditing";
import { useOutlookGoal } from "@/features/seriesComparison/outlook/useOutlookGoal";
import { useOutlookPatterns } from "@/features/seriesComparison/outlook/useOutlookPatterns";
import { useOutlookWorkspace } from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import { ChartInspectionProvider } from "@/features/seriesComparison/outlook/workspace/chart/ChartInspection";
import { OutlookAnswerStrip } from "@/features/seriesComparison/outlook/workspace/OutlookAnswerStrip";
import { OutlookAverageControl } from "@/features/seriesComparison/outlook/workspace/OutlookAverageControl";
import { OutlookDetails } from "@/features/seriesComparison/outlook/workspace/OutlookDetails";
import { OutlookGoalQuestion } from "@/features/seriesComparison/outlook/workspace/OutlookGoalQuestion";
import { OutlookTrendQuestion } from "@/features/seriesComparison/outlook/workspace/OutlookTrendQuestion";
import { OutlookBodyLayout } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceLayout";
import type { OutlookWorkspaceProps } from "@/features/seriesComparison/outlook/workspace/OutlookWorkspaceView";
import { useStickyWhenFits } from "@/features/seriesComparison/outlook/workspace/useStickyWhenFits";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

const notices = {
  "followed-recent": "直近の成績と総合成績を更新しました。",
  "kept-assumptions": "試している成績を残して実績を更新しました。",
} as const;

/**
 * The assumptions on the left, the two questions on the right. Layout carries the reading order,
 * so the text names only facts.
 */
export function OutlookWorkspace({ summary, selection }: OutlookWorkspaceProps) {
  const workspace = useOutlookWorkspace(summary, selection);
  const { view, edit, memberIds, names, displayRoles, recent, cumulative } = workspace;
  const range = outlookChartRange(view.goalHorizon);
  const pair = useMemo(() => [view.focus, view.rival] as const, [view.focus, view.rival]);
  const origin = useMemo(
    () => [view.originFocus, view.originRival] as const,
    [view.originFocus, view.originRival],
  );
  const recentGames = summary.recent.matchCount;
  const trend = useMemo(
    () => outlookTrendAnswer({ cumulative, pair, recent, names, range, recentGames }),
    [cumulative, pair, recent, names, range, recentGames],
  );
  const goalAnswer = useMemo(
    () =>
      outlookGoalAnswer({
        cumulative,
        pair,
        recent,
        focusSource: view.focusSource,
        goalHorizon: view.goalHorizon,
        names,
        recentGames,
      }),
    [cumulative, pair, recent, view.focusSource, view.goalHorizon, names, recentGames],
  );
  const goal = useOutlookGoal({ response: summary, focusMemberId: memberIds[0], view, cumulative });
  const patterns = useOutlookPatterns({
    active: true,
    response: summary,
    cumulative,
    pair,
    origin,
    memberIds,
    range,
  });
  const assumptions = useRef<HTMLElement>(null);
  const sticky = useStickyWhenFits(assumptions);

  return (
    <ChartInspectionProvider range={range}>
      <OutlookBodyLayout
        notice={
          view.notice ? (
            <Notice
              presentation="bare"
              tone="info"
              action={
                <Button size="sm" variant="quiet" onClick={() => edit({ kind: "dismiss-notice" })}>
                  閉じる
                </Button>
              }
            >
              {notices[view.notice]}
            </Notice>
          ) : null
        }
        strip={(placement) => (
          <OutlookAnswerStrip
            placement={placement}
            trend={trend.headline}
            goal={`目標${view.goalHorizon}戦後：${goalAnswer.short}`}
          />
        )}
        assumptionsSticky={sticky}
        assumptions={
          <section ref={assumptions} aria-labelledby="outlook-assumptions" className="grid gap-6">
            <h2 id="outlook-assumptions" className={contentText.heading}>
              これからの平均順位
            </h2>
            {([0, 1] as const).map((role) => (
              <OutlookAverageControl
                key={memberIds[role]}
                response={summary}
                names={names}
                memberIds={memberIds}
                role={role}
                recent={recent[role]}
              />
            ))}
          </section>
        }
        trend={
          <OutlookTrendQuestion
            names={names}
            memberIds={memberIds}
            cumulative={cumulative}
            pair={pair}
            origin={origin}
            answer={trend}
            patterns={patterns}
            range={range}
            gesturing={view.gesturing}
          />
        }
        goal={
          <OutlookGoalQuestion
            summary={summary}
            names={names}
            memberIds={memberIds}
            cumulative={cumulative}
            view={view}
            answer={goalAnswer}
            goal={goal}
            range={range}
            trendMarker={trend.marker}
            reviewHref={workspace.reviewHref}
            matchHref={workspace.matchHref}
            matchLabel={
              selection.seasonMasterId ? "このシーズンの確定戦績を見る" : "この作品の確定戦績を見る"
            }
          />
        }
        details={
          <OutlookDetails
            summary={summary}
            selection={selection}
            names={names}
            displayRoles={displayRoles}
            recent={recent}
            cumulative={cumulative}
            pair={pair}
            goalHorizon={view.goalHorizon}
            exampleLabels={patterns.trajectories
              .filter((line) => line.kind === "example")
              .map((line) => line.label)}
            exampleGapsAt={patterns.exampleGapsAt}
          />
        }
      />
    </ChartInspectionProvider>
  );
}
