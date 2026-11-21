import { ArrowLeftRight } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisSelection";
import { formatRational, rational } from "@/features/seriesComparison/outlook/calculation";
import type { RankDistribution } from "@/features/seriesComparison/outlook/calculation";
import {
  exactAverageFraction,
  outlookAverage,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import type { buildOutlookOutcomeView } from "@/features/seriesComparison/outlook/outlookProjections";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { orderFixedMembers } from "@/shared/domain/members";
import { formatDateOnly } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { IconButton } from "@/shared/ui/actions/IconButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

type ProjectionRow = ReturnType<typeof buildOutlookOutcomeView>["projectionRows"][number];
type DisplayRoles = ReadonlyArray<{ memberId: string; role: OutlookRole }>;

/** Who is compared and where they stand now; the rest of the page starts from this row. */
export function OutlookComparisonRow({
  summary,
  selection,
  memberIds,
  names,
  displayRoles,
  now,
  columnsClass,
  onMemberChange,
  onPairChange,
}: {
  summary: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisSelection;
  memberIds: readonly [string, string];
  names: readonly [string, string];
  displayRoles: DisplayRoles;
  now: ProjectionRow;
  columnsClass: string;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
  onPairChange?: ((focusMemberId: string, rivalMemberId: string) => void) | undefined;
}) {
  const lead = rational(
    now.gap.numerator < 0n ? -now.gap.numerator : now.gap.numerator,
    now.gap.denominator,
  );
  return (
    <div
      className={cn("grid min-w-0 grid-cols-1 items-end gap-x-10 gap-y-4", columnsClass)}
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
          <span className="text-text-primary">
            {now.relation === "tied"
              ? "同率"
              : `${now.relation === "ahead" ? names[0] : names[1]}が ${formatRational(lead, 2)} 先行`}
          </span>
        </p>
      </div>
    </div>
  );
}

/** Exact values and premises, folded away from the answers. */
export function OutlookDetails({
  summary,
  names,
  displayRoles,
  recent,
  projectionRows,
}: {
  summary: SeriesAnalysisOutlookSummary;
  names: readonly [string, string];
  displayRoles: DisplayRoles;
  recent: readonly [RankDistribution, RankDistribution];
  projectionRows: readonly ProjectionRow[];
}) {
  const period = summary.recent.period
    ? `（${formatDateOnly(summary.recent.period.startedAt)}〜${formatDateOnly(summary.recent.period.endedAt)}）`
    : "";
  return (
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
          minWidth="28rem"
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
              header: <MemberSequenceLabel memberId={memberId}>{names[role]}</MemberSequenceLabel>,
              align: "right" as const,
              tabular: true,
              renderCell: (row: ProjectionRow) =>
                `${outlookAverage(role === 0 ? row.focusAverage : row.rivalAverage)}位`,
            })),
            {
              key: "gap",
              header: `${names[0]}から見た差`,
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
            {summary.recent.matchCount}戦{period}
            です。この先も同じ平均の成績が続く条件で計算しています。
            {summary.recent.qualityStatus === "reference"
              ? "直近の実績が少ないため、見通しは参考値です。"
              : null}
          </p>
          <p className={contentText.supporting}>
            表示を丸めても、同率・逆転は丸める前の値で判定しています。{names[0]}の直近平均：
            {exactAverageFraction(recent[0])}、{names[1]}：{exactAverageFraction(recent[1])}
            （順位合計 / 戦数）。
          </p>
        </div>
      </div>
    </Disclosure>
  );
}

function navHeight() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--global-nav-height") || "0",
  );
  return Number.isFinite(value) ? value : 0;
}

/** Keep the inputs in view while reading the answers, only if the column fits the screen. */
export function useStickyWhenFits(ref: RefObject<HTMLElement | null>) {
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () => setFits(element.offsetHeight + navHeight() + 32 <= window.innerHeight);
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
