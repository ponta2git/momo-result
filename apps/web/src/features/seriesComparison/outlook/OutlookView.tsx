import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

import {
  distributionFromCounts,
  formatRational,
  nextMatchOutcomes,
  projectOutlook,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { OutlookGoalPanel } from "@/features/seriesComparison/outlook/OutlookGoalPanel";
import { OutlookHorizonControl } from "@/features/seriesComparison/outlook/OutlookHorizonControl";
import { outlookOutcome } from "@/features/seriesComparison/outlook/outlookOutcome";
import { OutlookPatterns } from "@/features/seriesComparison/outlook/OutlookPatterns";
import { OutlookPlayerEditor } from "@/features/seriesComparison/outlook/OutlookPlayerEditor";
import {
  exactAverageFraction,
  outlookAverage,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  OutlookComparisonControls,
  OutlookScenarioComparison,
} from "@/features/seriesComparison/outlook/OutlookScenarioComparison";
import {
  adoptOutlookSummary,
  finishOutlookGesture,
  outlookPlayer,
  undoOutlook,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookSession } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
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

function rangeFor(horizon: number): 50 | 100 | 200 {
  return horizon <= 50 ? 50 : horizon <= 100 ? 100 : 200;
}

export function OutlookView({
  response,
  selection,
  onMemberChange,
}: {
  response: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisUrlState;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  const { store, session: storedSession } = useOutlookSession();
  const pairIds = normalizeOutlookPair(selection.focusMemberId, selection.rivalMemberId);
  const scopeKey = seriesAnalysisScopeSignature(selection);
  const session = adoptOutlookSummary(storedSession, response, scopeKey, [
    pairIds.focusMemberId,
    pairIds.rivalMemberId,
  ]);
  useLayoutEffect(() => {
    store.update((current) =>
      adoptOutlookSummary(current, response, scopeKey, [
        pairIds.focusMemberId,
        pairIds.rivalMemberId,
      ]),
    );
  }, [store, response, scopeKey, pairIds.focusMemberId, pairIds.rivalMemberId]);
  useEffect(
    () => () => {
      store.update((current) => (current ? finishOutlookGesture(current) : current));
    },
    [store],
  );
  const change = useCallback(
    (update: (current: OutlookSession) => OutlookSession) => {
      store.update((current) => (current ? update(current) : current));
    },
    [store],
  );
  if (!session)
    return (
      <p className={cn(contentText.body, readableTextWidthClass)}>
        この範囲に確定済みの試合がありません。
      </p>
    );
  return (
    <OutlookWorkspace
      key={session.key}
      response={response}
      selection={selection}
      session={session}
      change={change}
      onMemberChange={onMemberChange}
    />
  );
}

function OutlookWorkspace({
  response,
  selection,
  session,
  change,
  onMemberChange,
}: {
  response: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisUrlState;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
  onMemberChange: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  const location = useLocation();
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const chartHeading = useRef<HTMLDivElement>(null);
  const { focusMemberId, rivalMemberId } = normalizeOutlookPair(
    selection.focusMemberId,
    selection.rivalMemberId,
  );
  const ids = useMemo(
    () => [focusMemberId, rivalMemberId] as const,
    [focusMemberId, rivalMemberId],
  );
  const names = [
    outlookPlayer(response.players, focusMemberId).displayName,
    outlookPlayer(response.players, rivalMemberId).displayName,
  ] as const;
  const displayRoles = orderFixedMembers(
    ids.map((memberId, role) => ({ memberId, role: role as OutlookRole })),
  );
  const recent = useMemo(
    () =>
      [
        distributionFromCounts(outlookPlayer(response.recent.players, focusMemberId).rankCounts),
        distributionFromCounts(outlookPlayer(response.recent.players, rivalMemberId).rankCounts),
      ] as const,
    [response.recent.players, focusMemberId, rivalMemberId],
  );
  const cumulative: CumulativePair = useMemo(
    () => ({
      games: response.scope.matchCount,
      focusRankSum: outlookPlayer(response.players, focusMemberId).rankSum,
      rivalRankSum: outlookPlayer(response.players, rivalMemberId).rankSum,
    }),
    [response.scope.matchCount, response.players, focusMemberId, rivalMemberId],
  );
  const distributions = [session.entries[0].distribution, session.entries[1].distribution] as const;
  const outcome = outlookOutcome(cumulative, distributions, names);
  const eventHorizon =
    outcome.eventHorizon !== null && outcome.eventHorizon <= 1000n
      ? Number(outcome.eventHorizon)
      : null;
  const selectHorizon = useCallback(
    (next: Pick<OutlookSession, "horizon" | "horizonText">) => {
      change((current) => ({
        ...current,
        ...next,
      }));
    },
    [change],
  );
  const usePerformance = () => {
    change((current) => ({
      ...current,
      task: "performance",
      horizon: current.goalHorizon,
      horizonText: String(current.goalHorizon),
      chartRange: Math.max(current.chartRange, rangeFor(current.goalHorizon)) as 50 | 100 | 200,
    }));
    requestAnimationFrame(() => {
      if (resultHeading.current) {
        resultHeading.current.focus({ preventScroll: true });
        revealPageElement(resultHeading.current, "start");
      }
    });
  };
  const numericRows = [...new Set([0, 10, 20, 50, 100, session.horizon])]
    .toSorted((a, b) => a - b)
    .map((h) => ({ h, ...projectOutlook(cumulative, distributions[0], distributions[1], h) }));
  const reviewSearch = new URLSearchParams(location.search);
  reviewSearch.set("view", "review");
  const reviewHref = `${location.pathname}?${reviewSearch}#review-member-${focusMemberId}`;
  const matchParams = new URLSearchParams({
    gameTitleId: response.artifact.gameTitleId,
    status: "confirmed",
  });
  if (selection.seasonMasterId) matchParams.set("seasonMasterId", selection.seasonMasterId);
  const matchHref = withReturnTo(`/matches?${matchParams}`, currentInternalLocation(location));
  const nextOutcomes = nextMatchOutcomes(cumulative).filter((next) =>
    outcome.crossing.current === "ahead"
      ? next.relation !== "ahead"
      : outcome.crossing.current === "behind"
        ? next.relation !== "behind"
        : true,
  );
  const playerProps = { response, cumulative, session, names, memberIds: ids, change };

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
              value={ids[role]}
              options={orderFixedMembers(response.players).map((player) => ({
                label: player.displayName,
                value: player.memberId,
                disabled: player.memberId === ids[role === 0 ? 1 : 0],
              }))}
              onValueChange={(id) => onMemberChange?.(role === 0 ? "focus" : "rival", id)}
            />
          ))}
        </div>
      </div>
      {session.notice ? (
        <p className={contentText.body} role="status">
          {session.notice}
        </p>
      ) : null}
      <TabsRoot
        value={session.task}
        onValueChange={(task) =>
          change((current) => ({ ...current, task: task as OutlookSession["task"] }))
        }
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
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={session.history.length === 0 && !session.gesture}
                    icon={<Undo2 aria-hidden="true" className="size-4" />}
                    onClick={() => change(undoOutlook)}
                  >
                    成績を1つ戻す
                  </Button>
                </div>
                <p className={contentText.supporting}>
                  小さいほど上位。初期値は作品全体の直近{response.recent.matchCount}戦です。
                </p>
              </div>
              <div className="grid gap-6">
                {displayRoles.map(({ memberId, role }) => (
                  <OutlookPlayerEditor key={memberId} {...playerProps} role={role} showComparison />
                ))}
              </div>
              <OutlookComparisonControls session={session} change={change} />
              {response.recent.qualityStatus === "reference" ? (
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
                  {session.pinned ? "平均どおりに進んだときの差" : "平均どおりに進むと"}
                </h2>
                {session.pinned ? (
                  <OutlookScenarioComparison
                    session={session}
                    cumulative={cumulative}
                    names={names}
                  />
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
                        change((current) => ({
                          ...current,
                          horizon: eventHorizon,
                          horizonText: String(eventHorizon),
                          chartRange: Math.max(current.chartRange, rangeFor(eventHorizon)) as
                            | 50
                            | 100
                            | 200,
                        }));
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
                  active={session.task === "performance"}
                  onHorizonChange={selectHorizon}
                  marker={
                    eventHorizon === null
                      ? null
                      : { h: eventHorizon, label: `${eventHorizon}戦後に${outcome.eventLabel}` }
                  }
                  horizonControl={
                    <OutlookHorizonControl
                      horizon={session.horizon}
                      horizonText={session.horizonText}
                      onChange={selectHorizon}
                      rangeControl={
                        <SelectField
                          label="表示範囲"
                          value={String(session.chartRange)}
                          options={[50, 100, 200].map((range) => ({
                            value: String(range),
                            label: `${range}戦`,
                          }))}
                          onValueChange={(value) =>
                            change((current) => ({
                              ...current,
                              chartRange: Number(value) as 50 | 100 | 200,
                            }))
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
            {session.task === "goal" ? (
              <OutlookGoalPanel
                {...playerProps}
                recent={recent}
                horizonControl={
                  <OutlookHorizonControl
                    label="目標の戦数"
                    horizon={session.goalHorizon}
                    horizonText={session.goalHorizonText}
                    onChange={({ horizon, horizonText }) =>
                      change((current) => ({
                        ...current,
                        goalHorizon: horizon,
                        goalHorizonText: horizonText,
                      }))
                    }
                  />
                }
                opponentEditor={<OutlookPlayerEditor {...playerProps} role={1} />}
                onUsePerformance={usePerformance}
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
            rows={numericRows}
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
                renderCell: (row: (typeof numericRows)[number]) =>
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
              累積は選択した範囲の{response.scope.matchCount}戦。初期値は作品全体の直近
              {response.recent.matchCount}戦
              {response.recent.period
                ? `（${formatDateOnly(response.recent.period.startedAt)}〜${formatDateOnly(response.recent.period.endedAt)}）`
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
