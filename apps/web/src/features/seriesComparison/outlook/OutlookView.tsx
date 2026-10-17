import { useCallback, useRef } from "react";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { formatRational } from "@/features/seriesComparison/outlook/calculation";
import { OutlookGoalPanel } from "@/features/seriesComparison/outlook/OutlookGoalPanel";
import {
  OutlookHorizonControl,
  OutlookGoalHorizonControl,
} from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { OutlookPastExamples } from "@/features/seriesComparison/outlook/OutlookPastExamples";
import { OutlookPatterns } from "@/features/seriesComparison/outlook/OutlookPatterns";
import { OutlookPlayerEditor } from "@/features/seriesComparison/outlook/OutlookPlayerEditor";
import {
  exactAverageFraction,
  outlookAverage,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  OutlookComparisonControls,
  OutlookUndoButton,
  OutlookScenarioComparison,
} from "@/features/seriesComparison/outlook/OutlookScenarioComparison";
import { OutlookSummaryBoundary } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookWorkspace } from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsRoot, TabsList, TabsTab, TabsPanel } from "@/shared/ui/forms/Tabs";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { revealPageElement } from "@/shared/ui/layout/revealPageElement";
import { contentText } from "@/shared/ui/typography";

export function OutlookView({
  summary,
  selection,
  onMemberChange,
}: {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  return (
    <OutlookSummaryBoundary
      response={summary}
      selection={selection}
      empty={
        <p className={cn(contentText.body, readableTextWidthClass)}>
          この範囲に確定済みの試合がありません。
        </p>
      }
    >
      <OutlookWorkspace summary={summary} selection={selection} onMemberChange={onMemberChange} />
    </OutlookSummaryBoundary>
  );
}

function OutlookWorkspace({
  summary,
  selection,
  onMemberChange,
}: {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  onMemberChange: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  const {
    view,
    edit,
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
  } = useOutlookWorkspace(summary, selection);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const chartHeading = useRef<HTMLDivElement>(null);
  const selectHorizon = useCallback(
    (next: { horizon: number; horizonText: string }) =>
      edit({
        kind: "horizon",
        target: "performance",
        horizon: next.horizon,
        text: next.horizonText,
      }),
    [edit],
  );
  const focusPerformanceResults = () => {
    requestAnimationFrame(() => {
      if (resultHeading.current) {
        resultHeading.current.focus({ preventScroll: true });
        revealPageElement(resultHeading.current, "start");
      }
    });
  };
  const playerProps = { response: summary, cumulative, names, memberIds };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div
        className="@container/outlook-people grid max-w-2xl min-w-0 grid-cols-1 gap-2"
        data-outlook-preserve-draft
      >
        <div className="grid min-w-0 gap-4 @xs/outlook-people:grid-cols-2">
          {([0, 1] as const).map((role) => (
            <SelectField
              key={role}
              label={role === 0 ? "注目する人" : "比較する相手"}
              value={memberIds[role]}
              options={orderFixedMembers(summary.players).map((player) => ({
                label: player.displayName,
                value: player.memberId,
                disabled: player.memberId === memberIds[role === 0 ? 1 : 0],
              }))}
              onValueChange={(id) => onMemberChange?.(role === 0 ? "focus" : "rival", id)}
            />
          ))}
        </div>
      </div>
      {view.notice ? (
        <p className={contentText.body} role="status">
          {view.notice}
        </p>
      ) : null}
      <TabsRoot
        value={view.task}
        onValueChange={(task) => edit({ kind: "task", task: task as "performance" | "goal" })}
      >
        <TabsList aria-label="見通しの使い方" variant="underline">
          <TabsTab value="performance">成績から試す</TabsTab>
          <TabsTab value="goal">戦数から考える</TabsTab>
        </TabsList>
        <TabsPanel value="performance" keepMounted>
          <div className="grid min-w-0 grid-cols-1 gap-6 pt-6 lg:grid-cols-[minmax(18rem,2fr)_minmax(0,3fr)]">
            <section
              className="grid min-w-0 grid-cols-1 content-start gap-6"
              aria-labelledby="outlook-assumptions"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="outlook-assumptions" className={contentText.heading}>
                    これからの成績
                  </h2>
                  <OutlookUndoButton />
                </div>
                <p className={contentText.supporting}>
                  小さいほど上位。初期値は作品全体の直近{summary.recent.matchCount}戦です。
                </p>
              </div>
              <div className="grid gap-6">
                {displayRoles.map(({ memberId, role }) => (
                  <div key={memberId} className="grid min-w-0 gap-4">
                    <OutlookPlayerEditor {...playerProps} role={role} showComparison />
                    {view.task === "performance" ? (
                      <OutlookPastExamples
                        response={summary}
                        memberId={memberId}
                        memberName={names[role]}
                        condition={{ kind: "mean", role }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              <OutlookComparisonControls />
              {summary.recent.qualityStatus === "reference" ? (
                <p className={contentText.supporting}>
                  直近の実績が少ないため、見通しは参考値です。
                </p>
              ) : null}
            </section>
            <div className="grid min-w-0 grid-cols-1 content-start gap-6">
              <section className="grid min-w-0 gap-2" aria-labelledby="outlook-conclusion">
                <h2
                  ref={resultHeading}
                  id="outlook-conclusion"
                  tabIndex={-1}
                  className={contentText.heading}
                >
                  {view.pinnedFocus ? "平均どおりに進んだときの差" : "平均どおりに進むと"}
                </h2>
                {view.pinnedFocus ? (
                  <OutlookScenarioComparison cumulative={cumulative} names={names} />
                ) : (
                  <>
                    <p className={cn(contentText.primary, "min-h-14")}>{outcome.headline}</p>
                    <p className={cn(contentText.supporting, "min-h-4")}>{outcome.detail}</p>
                  </>
                )}
                <div
                  className="flex min-h-11 flex-wrap gap-2 pointer-fine:min-h-9"
                  data-outlook-preserve-draft
                >
                  {eventHorizon !== null ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        edit({ kind: "show-horizon", horizon: eventHorizon });
                        requestAnimationFrame(() => {
                          if (chartHeading.current) revealPageElement(chartHeading.current);
                        });
                      }}
                    >
                      {eventHorizon}戦後{eventHorizon > 200 ? "の数値" : ""}を見る
                    </Button>
                  ) : null}
                </div>
              </section>
              <div ref={chartHeading} className="min-w-0">
                <OutlookPatterns
                  {...playerProps}
                  view={view}
                  active={view.task === "performance"}
                  onHorizonChange={selectHorizon}
                  marker={
                    eventHorizon === null
                      ? null
                      : { h: eventHorizon, label: `${eventHorizon}戦後に${outcome.eventLabel}` }
                  }
                  horizonControl={
                    <OutlookHorizonControl
                      horizon={view.horizon}
                      horizonText={view.horizonText}
                      onChange={selectHorizon}
                      rangeControl={
                        <SelectField
                          label="表示範囲"
                          value={String(view.chartRange)}
                          options={[50, 100, 200].map((range) => ({
                            value: String(range),
                            label: `${range}戦`,
                          }))}
                          onValueChange={(value) =>
                            edit({ kind: "chart-range", range: Number(value) as 50 | 100 | 200 })
                          }
                        />
                      }
                    />
                  }
                />
              </div>
            </div>
          </div>
        </TabsPanel>
        <TabsPanel value="goal" keepMounted>
          <div className="min-w-0 pt-6">
            {view.task === "goal" ? (
              <OutlookGoalPanel
                {...playerProps}
                recent={recent}
                horizonControl={<OutlookGoalHorizonControl />}
                opponentEditor={<OutlookPlayerEditor {...playerProps} role={1} />}
                onUsePerformance={focusPerformanceResults}
                reviewLinks={
                  <div className="flex flex-wrap gap-2">
                    <LinkButton variant="secondary" size="sm" to={reviewHref}>
                      {names[0]}の行動仮説を見る
                    </LinkButton>
                    <LinkButton variant="quiet" size="sm" to={matchHref}>
                      {selection.seasonMasterId
                        ? "このシーズンの確定戦績を見る"
                        : "この作品の確定戦績を見る"}
                    </LinkButton>
                  </div>
                }
              />
            ) : null}
          </div>
        </TabsPanel>
      </TabsRoot>
      <Disclosure
        summary="数値と計算の前提"
        ariaLabel="数値と計算の前提"
        triggerLayout="flush-horizontal"
        panelSpacing="sm"
      >
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <DataTable
            caption={{ content: "今後の総合平均順位の詳しい数値", visibility: "screen-reader" }}
            rows={projectionRows}
            getRowKey={(row) => String(row.h)}
            density="compact"
            minWidth="32rem"
            stickyRowHeader
            columns={[
              {
                key: "h",
                header: "この先",
                rowHeader: true,
                renderCell: (row) => (row.h === 0 ? "現在" : `${row.h}戦後`),
              },
              ...displayRoles.map(({ memberId, role }) => ({
                key: memberId,
                header: (
                  <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
                ),
                tabular: true,
                renderCell: (row: (typeof projectionRows)[number]) =>
                  `${outlookAverage(role === 0 ? row.focusAverage : row.rivalAverage)}位`,
              })),
              {
                key: "gap",
                header: "平均順位の差",
                tabular: true,
                renderCell: (row) =>
                  `${formatRational(row.gap, 4)} · ${row.relation === "tied" ? "同率" : `${row.relation === "ahead" ? names[0] : names[1]}が上`}`,
              },
            ]}
          />
          <div className={cn("grid gap-2", readableTextWidthClass)}>
            <p className={contentText.body}>
              累積は選択した範囲の{summary.scope.matchCount}戦。初期値は作品全体の直近
              {summary.recent.matchCount}戦
              {summary.recent.period
                ? `（${formatDateOnly(summary.recent.period.startedAt)}〜${formatDateOnly(summary.recent.period.endedAt)}）`
                : ""}
              です。この先も同じ平均の成績が続く条件で計算しています。
            </p>
            <p className={contentText.supporting}>
              表示を丸めても、同率・逆転は丸め前の値で判定しています。{names[0]}の直近平均：
              {exactAverageFraction(recent[0])}、{names[1]}：{exactAverageFraction(recent[1])}
              （順位合計 / 戦数）。
            </p>
            {nextOutcomes.length ? (
              <p className={contentText.body}>
                実際の次戦では、
                {nextOutcomes
                  .map(
                    (next) =>
                      `${names[0]}${next.focusRank}位・${names[1]}${next.rivalRank}位で${next.relation === "tied" ? "同率" : `${next.relation === "ahead" ? names[0] : names[1]}が上`}`,
                  )
                  .join("。")}
              </p>
            ) : null}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
