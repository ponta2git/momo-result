import { useMemo } from "react";

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
} from "@/features/seriesComparison/drilldowns/SeriesComparisonDrilldownPrimitives";
import { RankAverageDeltaBadge } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownSummary";
import type {
  RankEventRow,
  RankMatchRow,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldownTypes";
import {
  formatDecimal,
  isNumber,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";

export function HeldEventHistoryTable({ rows }: { rows: RankEventRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareEventRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="開催ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="開催ごとの順位履歴">
      <table className="w-full min-w-[62rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">
              開催
            </DrilldownTableHeader>
            <DrilldownTableHeader align="right">試合数</DrilldownTableHeader>
            <DrilldownTableHeader>順位列</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催平均</DrilldownTableHeader>
            <DrilldownTableHeader>開催内変動</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催前平均</DrilldownTableHeader>
            <DrilldownTableHeader align="right">開催後平均</DrilldownTableHeader>
            <DrilldownTableHeader>開催による変動</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.heldEventId}>
              <DrilldownStickyCell>
                <span className="block font-semibold">
                  {formatDrilldownDate(row.firstPlayedAt)}
                </span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortDrilldownId(row.heldEventId)}
                </span>
              </DrilldownStickyCell>
              <DrilldownTableCell align="right">{row.matchCount}戦</DrilldownTableCell>
              <DrilldownTableCell>
                {(row.ranks ?? []).map((rank) => `${rank}位`).join(" → ")}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.eventAverageRank)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.eventRankDelta} valueKind="rank" />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageBefore)}
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageAfter)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.cumulativeAverageDelta} valueKind="decimal" />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

export function MatchHistoryTable({ rows }: { rows: RankMatchRow[] }) {
  const sortedRows = useMemo(() => rows.toSorted(compareMatchRowDesc), [rows]);
  if (rows.length === 0) {
    return <EmptyState title="試合ごとの履歴がありません" description="対象試合がありません。" />;
  }
  return (
    <DrilldownTableScroll ariaLabel="試合ごとの順位履歴">
      <table className="w-full min-w-[64rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <DrilldownTableHeader className="sticky left-0 z-[calc(var(--z-sticky)+1)]">
              対戦順
            </DrilldownTableHeader>
            <DrilldownTableHeader>開催</DrilldownTableHeader>
            <DrilldownTableHeader align="right">第n試合</DrilldownTableHeader>
            <DrilldownTableHeader align="right">順位</DrilldownTableHeader>
            <DrilldownTableHeader align="right">前戦順位</DrilldownTableHeader>
            <DrilldownTableHeader>順位変動</DrilldownTableHeader>
            <DrilldownTableHeader align="right">試合後平均順位</DrilldownTableHeader>
            <DrilldownTableHeader>平均順位変動</DrilldownTableHeader>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr className="group hover:bg-[var(--color-surface-subtle)]" key={row.matchId}>
              <DrilldownStickyCell>
                <span className="font-semibold tabular-nums">{row.matchIndex}戦目</span>
              </DrilldownStickyCell>
              <DrilldownTableCell>
                <span className="block">{formatDrilldownDate(row.playedAt)}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">
                  {shortDrilldownId(row.heldEventId)}
                </span>
              </DrilldownTableCell>
              <DrilldownTableCell align="right">第{row.matchNoInEvent}試合</DrilldownTableCell>
              <DrilldownTableCell align="right">{row.rank}位</DrilldownTableCell>
              <DrilldownTableCell align="right">
                {isNumber(row.previousRank) ? `${row.previousRank}位` : "初戦"}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.rankDelta} valueKind="rank" />
              </DrilldownTableCell>
              <DrilldownTableCell align="right">
                {formatDecimal(row.cumulativeAverageRank)}
              </DrilldownTableCell>
              <DrilldownTableCell>
                <RankAverageDeltaBadge value={row.cumulativeAverageRankDelta} valueKind="decimal" />
              </DrilldownTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </DrilldownTableScroll>
  );
}

function compareEventRowDesc(left: RankEventRow, right: RankEventRow): number {
  return (
    compareTimestampDesc(left.firstPlayedAt, right.firstPlayedAt) ||
    right.heldEventId.localeCompare(left.heldEventId)
  );
}

function compareMatchRowDesc(left: RankMatchRow, right: RankMatchRow): number {
  return (
    compareTimestampDesc(left.playedAt, right.playedAt) ||
    right.matchNoInEvent - left.matchNoInEvent ||
    right.matchIndex - left.matchIndex ||
    right.heldEventId.localeCompare(left.heldEventId) ||
    right.matchId.localeCompare(left.matchId)
  );
}
