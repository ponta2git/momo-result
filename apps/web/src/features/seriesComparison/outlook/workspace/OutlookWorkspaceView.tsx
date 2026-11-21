import { ArrowLeftRight, Pin, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useLocation } from "react-router-dom";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import {
  distributionMean,
  formatRational,
  projectOutlook,
  rational,
} from "@/features/seriesComparison/outlook/calculation";
import {
  exactAverageFraction,
  outlookAverage,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import { OutlookView } from "@/features/seriesComparison/outlook/OutlookView";
import { OutlookSummaryBoundary } from "@/features/seriesComparison/outlook/OutlookWorkspaceProvider";
import { useOutlookGoal } from "@/features/seriesComparison/outlook/useOutlookGoal";
import {
  useOutlookToolbar,
  useOutlookWorkspace,
} from "@/features/seriesComparison/outlook/useOutlookWorkspace";
import {
  OutlookConclusion,
  OutlookGoalSummary,
} from "@/features/seriesComparison/outlook/workspace/OutlookAnswer";
import { OutlookAverageControl } from "@/features/seriesComparison/outlook/workspace/OutlookAverageControl";
import { OutlookNeedLineChart } from "@/features/seriesComparison/outlook/workspace/OutlookNeedLineChart";
import type { OutlookPreview } from "@/features/seriesComparison/outlook/workspace/OutlookNeedLineChart";
import { OutlookTrajectory } from "@/features/seriesComparison/outlook/workspace/OutlookTrajectory";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import {
  MemberSequenceLabel,
  memberSequencePresentation,
} from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { Notice } from "@/shared/ui/feedback/Notice";
import { SegmentedControl } from "@/shared/ui/forms/SegmentedControl";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { revealPageElement } from "@/shared/ui/layout/revealPageElement";
import { contentText } from "@/shared/ui/typography";

type Props = {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
  onPairChange?: ((focusMemberId: string, rivalMemberId: string) => void) | undefined;
};

/**
 * Prototype of the rebuilt outlook (one workspace, no sub-tabs). `outlookLayout=current`
 * keeps the released layout reachable for side-by-side trials.
 */
export function OutlookWorkspaceView({ summary, selection, onMemberChange, onPairChange }: Props) {
  const location = useLocation();
  if (new URLSearchParams(location.search).get("outlookLayout") === "current")
    return <OutlookView summary={summary} selection={selection} onMemberChange={onMemberChange} />;
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
      <Workspace
        summary={summary}
        selection={selection}
        onMemberChange={onMemberChange}
        onPairChange={onPairChange}
      />
    </OutlookSummaryBoundary>
  );
}

function Workspace({ summary, selection, onMemberChange, onPairChange }: Props) {
  const workspace = useOutlookWorkspace(summary, selection);
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
  } = workspace;
  const toolbar = useOutlookToolbar();
  const goal = useOutlookGoal({ response: summary, cumulative, memberIds, recent });
  const [preview, setPreview] = useState<OutlookPreview>(null);
  const previewChange = useCallback((next: OutlookPreview) => setPreview(next), []);
  const left = useRef<HTMLDivElement>(null);
  const conclusion = useRef<HTMLElement>(null);
  const trajectory = useRef<HTMLElement>(null);
  const sticky = useStickyWhenFits(left);
  const conclusionPassed = useScrolledPast(conclusion);

  const now =
    projectionRows.find((row) => row.h === 0) ??
    projectOutlook(cumulative, view.focus, view.rival, 0);
  const nowGap =
    now.relation === "tied"
      ? "同率"
      : `${now.relation === "ahead" ? names[0] : names[1]}が ${formatRational(
          rational(
            now.gap.numerator < 0n ? -now.gap.numerator : now.gap.numerator,
            now.gap.denominator,
          ),
          2,
        )} 先行`;
  const showHorizon = (horizon: number) => {
    edit({ kind: "show-horizon", horizon });
    requestAnimationFrame(() => {
      if (trajectory.current) {
        trajectory.current.focus({ preventScroll: true });
        revealPageElement(trajectory.current, "start");
      }
    });
  };
  const goalLabel = `目標 ${goal.goalHorizon}戦後`;
  const goalSummary =
    goal.maximum !== null && !goal.reaches
      ? `目標${goal.goalHorizon}戦後：平均${(goal.maximum / 100).toFixed(2)}位以下`
      : goal.reaches
        ? `目標${goal.goalHorizon}戦後：今の平均で届く`
        : `目標${goal.goalHorizon}戦後：届かない条件`;
  const pending = toolbar.view.pending;
  const initialNote = `初期値は作品全体の直近${summary.recent.matchCount}戦${
    summary.recent.period
      ? `（${formatDateOnly(summary.recent.period.startedAt)}〜${formatDateOnly(summary.recent.period.endedAt)}）`
      : ""
  }。小さいほど上位。${summary.recent.qualityStatus === "reference" ? "直近の実績が少ないため参考値です。" : ""}`;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <div
        className="grid min-w-0 grid-cols-1 items-end gap-x-10 gap-y-4 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]"
        data-outlook-preserve-draft
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
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
          <IconButton
            variant="quiet"
            icon={<ArrowLeftRight />}
            aria-label="注目する人と比較する相手を入れ替える"
            tooltip="入れ替える"
            onClick={() => onPairChange?.(memberIds[1], memberIds[0])}
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <p className={contentText.supporting}>
            {selection.seasonMasterId ? "今のシーズン総合平均" : "今の総合平均"}（
            {summary.scope.matchCount}戦）
          </p>
          <p
            className={cn(
              contentText.body,
              "flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 tabular-nums",
            )}
          >
            {displayRoles.map(({ memberId, role }) => (
              <span key={memberId} className="inline-flex items-center">
                <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
                <span className="ml-1.5">
                  {formatRational(role === 0 ? now.focusAverage : now.rivalAverage, 2)}位
                </span>
              </span>
            ))}
            <span className="text-text-primary">{nowGap}</span>
          </p>
        </div>
      </div>
      {view.notice ? (
        <Notice presentation="bare" tone="info">
          {view.notice}
        </Notice>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)] lg:items-start">
        <div
          ref={left}
          className={cn(
            "grid min-w-0 content-start gap-7",
            sticky && "lg:sticky lg:top-(--sticky-below-nav)",
          )}
        >
          <OutlookConclusion
            ref={conclusion}
            cumulative={cumulative}
            names={names}
            outcome={outcome}
            eventHorizon={eventHorizon}
            nextOutcomes={nextOutcomes}
            onShowHorizon={showHorizon}
          />
          <section className="grid min-w-0 gap-5" aria-labelledby="outlook-assumptions">
            <div className="grid gap-1">
              <div
                className="flex flex-wrap items-center justify-between gap-x-2"
                data-outlook-preserve-draft
              >
                <h2 id="outlook-assumptions" className={contentText.heading}>
                  これからの平均順位
                </h2>
                <div className="-mr-2 flex items-center">
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={!toolbar.view.canUndo}
                    icon={<Undo2 aria-hidden="true" className="size-4" />}
                    onClick={toolbar.undo}
                  >
                    1つ戻す
                  </Button>
                  {toolbar.view.pinned ? (
                    <Button size="sm" variant="quiet" onClick={toolbar.unpin}>
                      比較を終える
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={<Pin aria-hidden="true" className="size-4" />}
                    disabled={!toolbar.view.canPin}
                    aria-describedby="outlook-assumptions-note"
                    onClick={toolbar.pin}
                  >
                    {toolbar.view.pinned ? "基準を更新" : "残して比べる"}
                  </Button>
                </div>
              </div>
              <p id="outlook-assumptions-note" className={contentText.supporting}>
                {pending ? "残して比べる前に、入力を反映するか取り消してください。" : initialNote}
              </p>
            </div>
            {([0, 1] as const).map((role) => (
              <OutlookAverageControl
                key={memberIds[role]}
                response={summary}
                cumulative={cumulative}
                names={names}
                memberIds={memberIds}
                role={role}
                recent={recent[role]}
                baseline={role === 0 ? view.pinnedFocus : view.pinnedRival}
                onPreviewChange={previewChange}
              />
            ))}
          </section>
        </div>
        <div className="grid min-w-0 content-start gap-10">
          <OutlookGoalSummary
            response={summary}
            cumulative={cumulative}
            names={names}
            memberIds={memberIds}
            recent={recent}
            goal={goal}
            reviewHref={reviewHref}
            matchHref={matchHref}
            seasonSelected={Boolean(selection.seasonMasterId)}
          />
          <section className="grid min-w-0 gap-3" aria-labelledby="outlook-need-line">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 id="outlook-need-line" className={contentText.heading}>
                続ける戦数と必要な平均
                <span className={cn(contentText.supporting, "ml-2")}>
                  {names[1]}が {outlookAverage(distributionMean(view.rival))}位を続ける場合
                </span>
              </h2>
              <SegmentedControl
                label="グラフの範囲"
                value={String(view.chartRange)}
                options={[50, 100, 200].map((range) => ({
                  value: String(range),
                  label: `${range}戦`,
                }))}
                onValueChange={(value) =>
                  edit({ kind: "chart-range", range: Number(value) as 50 | 100 | 200 })
                }
              />
            </div>
            <NeedLineLegend
              names={names}
              memberIds={memberIds}
              preview={preview}
              pinned={toolbar.view.pinned}
            />
            <OutlookNeedLineChart
              names={names}
              memberIds={memberIds}
              cumulative={cumulative}
              focus={view.focus}
              rival={view.rival}
              baseline={
                view.pinnedFocus && view.pinnedRival
                  ? [view.pinnedFocus, view.pinnedRival]
                  : undefined
              }
              preview={preview}
              range={view.chartRange}
              goal={{ horizon: goal.goalHorizon, label: goalLabel }}
              crossingLabel={
                outcome.crossing.exactTie !== null && outcome.crossing.exactTie > 0n
                  ? `${outcome.crossing.exactTie}戦後に同率`
                  : eventHorizon !== null
                    ? `${eventHorizon}戦後`
                    : null
              }
              ariaLabel={`${names[0]}が${names[1]}より上にいるのに必要なこれからの平均。${outcome.headline}。${goalLabel}。`}
            />
            <p className={contentText.supporting}>
              縦軸は平均順位で、上ほど良い成績です。黒い線より上の平均を続ければ、その戦数で
              {names[0]}が上にいます。
            </p>
          </section>
          <OutlookTrajectory
            ref={trajectory}
            response={summary}
            cumulative={cumulative}
            names={names}
            memberIds={memberIds}
            displayRoles={displayRoles}
            outcome={outcome}
            eventHorizon={eventHorizon}
          />
          <Disclosure
            summary="詳しい数値と計算の前提"
            ariaLabel="詳しい数値と計算の前提"
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
                    renderCell: (row) => (row.h === 0 ? "今" : `${row.h}戦後`),
                  },
                  ...displayRoles.map(({ memberId, role }) => ({
                    key: memberId,
                    header: (
                      <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>
                    ),
                    align: "right" as const,
                    tabular: true,
                    renderCell: (row: (typeof projectionRows)[number]) =>
                      `${outlookAverage(role === 0 ? row.focusAverage : row.rivalAverage)}位`,
                  })),
                  {
                    key: "gap",
                    header: "平均順位の差",
                    align: "right",
                    tabular: true,
                    renderCell: (row) =>
                      `${formatRational(row.gap, 4)}・${row.relation === "tied" ? "同率" : `${row.relation === "ahead" ? names[0] : names[1]}が上`}`,
                  },
                ]}
              />
              <div className={cn("grid gap-2", readableTextWidthClass)}>
                <p className={contentText.body}>
                  今の総合平均は選んだ範囲の{summary.scope.matchCount}
                  戦、これからの平均の初期値は作品全体の直近
                  {summary.recent.matchCount}
                  戦です。この先も同じ平均の成績が続く条件で計算しています。
                </p>
                <p className={contentText.supporting}>
                  表示を丸めても、同率・逆転は丸め前の値で判定しています。{names[0]}の直近平均：
                  {exactAverageFraction(recent[0])}、{names[1]}：{exactAverageFraction(recent[1])}
                  （順位合計 / 戦数）。
                </p>
              </div>
            </div>
          </Disclosure>
        </div>
      </div>
      {conclusionPassed ? (
        <div
          className="fixed inset-x-0 top-(--global-nav-height) z-(--z-sticky) border-b border-border bg-surface px-4 py-2 shadow-raised lg:hidden"
          aria-hidden="true"
        >
          <p className={contentText.supporting}>
            {toolbar.view.pinned ? "残した条件と比べると" : "この平均が続くと"}
          </p>
          <p className={contentText.compactPrimary}>{outcome.headline}</p>
          <p className={contentText.supporting}>{goalSummary}</p>
        </div>
      ) : null}
    </div>
  );
}

function legendItem(key: string, stroke: string, text: string, dasharray?: string, opacity = 1) {
  return (
    <span key={key} className="inline-flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden="true">
        <line
          x1="0"
          x2="22"
          y1="4"
          y2="4"
          stroke={stroke}
          strokeOpacity={opacity}
          strokeWidth="2.5"
          strokeDasharray={dasharray}
        />
      </svg>
      {text}
    </span>
  );
}

function NeedLineLegend({
  names,
  memberIds,
  preview,
  pinned,
}: {
  names: readonly [string, string];
  memberIds: readonly [string, string];
  preview: OutlookPreview;
  pinned: boolean;
}) {
  const people = orderFixedMembers(
    memberIds.map((memberId, role) => ({ memberId, role: role as 0 | 1 })),
  );
  const dash = (role: 0 | 1) =>
    people.findIndex((person) => person.role === role) === 1 ? "6 4" : undefined;
  const color = (role: 0 | 1) => memberSequencePresentation(memberIds[role]).color;
  return (
    <div className={cn(contentText.supporting, "flex flex-wrap items-center gap-x-4 gap-y-1")}>
      {legendItem("need", "var(--color-text-primary)", "上回るのに必要な平均")}
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-3.5 rounded-xs"
          style={{ backgroundColor: color(0), opacity: 0.18 }}
          aria-hidden="true"
        />
        {names[0]}が上になる範囲
      </span>
      {legendItem("focus", color(0), `${names[0]}（これから）`, dash(0))}
      {legendItem("rival", color(1), `${names[1]}（これから）`, dash(1))}
      {pinned ? legendItem("pinned", color(0), "残した条件", "2 3", 0.6) : null}
      {preview
        ? legendItem(
            "preview",
            preview.role === 0 ? color(0) : "var(--color-text-primary)",
            "回数の試し（未適用）",
            "2 3",
            0.8,
          )
        : null}
    </div>
  );
}

/** Keep the inputs and the result in view while reading charts, only if the column fits. */
function useStickyWhenFits(ref: RefObject<HTMLElement | null>) {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => {
      const nav = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--global-nav-height") || "0",
      );
      setFits(element.offsetHeight + (Number.isFinite(nav) ? nav : 0) + 32 <= window.innerHeight);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [ref]);
  return fits;
}

/** True once the element has scrolled above the viewport top, so a compact copy can take over. */
function useScrolledPast(ref: RefObject<HTMLElement | null>) {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // The sticky global navigation covers the top of the viewport; treat that band as outside.
    const nav = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--global-nav-height") || "0",
    );
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setPassed(!entry.isIntersecting && entry.boundingClientRect.top < nav);
      },
      { rootMargin: `-${Number.isFinite(nav) ? Math.round(nav) : 0}px 0px 0px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return passed;
}
