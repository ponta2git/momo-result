import { useMemo } from "react";
import { Link } from "react-router-dom";

import {
  compareTimestampDesc,
  formatDrilldownDate,
  shortDrilldownId,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownFormat";
import {
  DrilldownStickyCell,
  DrilldownTableCell,
  DrilldownTableHeader,
  DrilldownTableScroll,
  LowerIsBetterDeltaBadge,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import type {
  PlayOrderRow,
  PlayOrderTrendRow,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonPlayOrderDrilldownTypes";
import {
  formatDecimal,
  formatPercent,
  formatPlayOrderLabel,
  playOrderColor,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { withReturnTo } from "@/shared/navigation/returnTo";
import { useCurrentLocationPath } from "@/shared/navigation/useCurrentLocationPath";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

export function PlayOrderBreakdownTable({ rows }: { rows: PlayOrderRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="番手ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="番手ごとの成績履歴">
      <table className="w-full min-w-[72rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[var(--z-sticky-raised)]">
              番手
            </DrilldownTableHeader>
            <DrilldownTableHeader align="right">対象戦数</DrilldownTableHeader>
            <DrilldownTableHeader align="right">平均順位</DrilldownTableHeader>
            <DrilldownTableHeader>順位分布</DrilldownTableHeader>
            <DrilldownTableHeader align="right">入賞率</DrilldownTableHeader>
            <DrilldownTableHeader align="right">下位率</DrilldownTableHeader>
            <DrilldownTableHeader align="right">全体同番手平均</DrilldownTableHeader>
            <DrilldownTableHeader>全体平均との差</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.playOrder}>
              <DrilldownStickyCell>
                <PlayOrderPill playOrder={row.playOrder} />
              </DrilldownStickyCell>
              <DrilldownTableCell align="right">{row.matchCount}戦</DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.rankAverage)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                {formatRankDistribution(row.rankDistribution ?? [])}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {row.matchCount > 0
                  ? `${row.podiumCount}回・${formatPercent(row.podiumRate)}`
                  : "-"}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {row.matchCount > 0
                  ? `${row.lowerHalfCount}回・${formatPercent(row.lowerHalfRate)}`
                  : "-"}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.baselineRankAverage)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <BaselineDeltaBadge value={row.baselineDelta} />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

export function PlayOrderTrendTable({ rows }: { rows: PlayOrderTrendRow[] }) {
  const returnTo = useCurrentLocationPath();
  const sortedRows = useMemo(() => rows.toSorted(compareTrendRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="推移データがありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="番手別平均順位推移の実データ">
      <table className="w-full min-w-[78rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[var(--z-sticky-raised)]">
              対戦順
            </DrilldownTableHeader>
            <DrilldownTableHeader>開催</DrilldownTableHeader>
            <DrilldownTableHeader align="right">第n試合</DrilldownTableHeader>
            <DrilldownTableHeader>番手</DrilldownTableHeader>
            <DrilldownTableHeader align="right">番手内</DrilldownTableHeader>
            <DrilldownTableHeader align="right">順位</DrilldownTableHeader>
            <DrilldownTableHeader align="right">試合後平均</DrilldownTableHeader>
            <DrilldownTableHeader>平均変化</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.matchId}>
              <DrilldownStickyCell>
                <Link
                  aria-label={`${row.matchIndex}戦目の試合結果を見る`}
                  className="inline-flex min-h-11 items-center font-semibold text-[var(--color-action)] tabular-nums underline-offset-4 hover:underline"
                  to={withReturnTo(`/matches/${encodeURIComponent(row.matchId)}`, returnTo)}
                >
                  {row.matchIndex}戦目
                </Link>
              </DrilldownStickyCell>
              <DrilldownTableCell>
                <span className="block">{formatDrilldownDate(row.playedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortDrilldownId(row.heldEventId)}
                </span>
              </DrilldownTableCell>
              <DrilldownTableCell align="right">第{row.matchNoInEvent}試合</DrilldownTableCell>
              <DrilldownTableCell>
                <PlayOrderPill playOrder={row.playOrder} />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {row.playOrderOccurrenceIndex}戦目
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                <RankBadge rank={row.rank} />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageRankByPlayOrder)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <AverageDeltaBadge value={row.cumulativeAverageRankDeltaByPlayOrder} />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

export function PlayOrderPill({ playOrder }: { playOrder: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-semibold">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: playOrderColor(playOrder) }}
      />
      {formatPlayOrderLabel(playOrder)}
    </span>
  );
}

function BaselineDeltaBadge({ value }: { value: number | null | undefined }) {
  return (
    <LowerIsBetterDeltaBadge
      labels={baselineDeltaLabels}
      nullLabel="-"
      value={value}
      valueKind="decimal"
    />
  );
}

function AverageDeltaBadge({ value }: { value: number | null | undefined }) {
  return (
    <LowerIsBetterDeltaBadge
      labels={averageDeltaLabels}
      nullLabel="-"
      value={value}
      valueKind="decimal"
    />
  );
}

const baselineDeltaLabels = {
  negative: "良い",
  positive: "重い",
  zero: "同等",
} as const;

const averageDeltaLabels = {
  negative: "改善",
  positive: "後退",
  zero: "維持",
} as const;

function formatRankDistribution(
  rows: Array<{ count: number; rank: number; rate?: number | undefined }>,
): string {
  if (rows.length === 0) {
    return "-";
  }
  return rows.map((row) => `${row.rank}位 ${row.count}回`).join(" / ");
}

function compareTrendRowDesc(left: PlayOrderTrendRow, right: PlayOrderTrendRow): number {
  return (
    compareTimestampDesc(left.playedAt, right.playedAt) ||
    right.matchNoInEvent - left.matchNoInEvent ||
    right.matchIndex - left.matchIndex ||
    right.heldEventId.localeCompare(left.heldEventId) ||
    right.matchId.localeCompare(left.matchId)
  );
}
