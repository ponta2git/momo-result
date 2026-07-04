import { motion } from "motion/react";

import type {
  Player,
  PlayOrderHeatmapRow,
  RevenueRankConversionEntry,
} from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { isFiniteNumber } from "@/features/seriesComparison/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import {
  formatDecimal,
  formatPercent,
  formatPlayOrderLabel,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  rankAverageTone,
  rankBackgroundColor,
  rankBorderColor,
} from "@/features/seriesComparison/SeriesComparisonRankColors";
import { momoTransition } from "@/shared/ui/motion/variants";

export function PlayOrderHeatmap({
  players,
  rows,
}: {
  players: Player[];
  rows: PlayOrderHeatmapRow[];
}) {
  const rowByMember = new Map(rows.map((row) => [row.memberId, row]));
  const values = rows.flatMap((row) =>
    row.cells.flatMap((cell) => (isFiniteNumber(cell.rankAverage) ? [cell.rankAverage] : [])),
  );
  const minValue = values.length === 0 ? undefined : Math.min(...values);
  const maxValue = values.length === 0 ? undefined : Math.max(...values);
  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{
          gridTemplateColumns: "7rem repeat(4, minmax(7.5rem, 1fr))",
        }}
      >
        <div aria-hidden="true" />
        {[1, 2, 3, 4].map((playOrder) => (
          <div
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-1.5 text-center text-xs font-semibold text-[var(--color-text-primary)]"
            key={playOrder}
          >
            {formatPlayOrderLabel(playOrder)}
          </div>
        ))}
        {players.map((player, index) => {
          const row = rowByMember.get(player.memberId);
          return (
            <PlayOrderHeatmapPlayerRow
              index={index}
              key={player.memberId}
              maxValue={maxValue}
              minValue={minValue}
              player={player}
              row={row}
            />
          );
        })}
      </div>
    </div>
  );
}

export function RevenueRankConversionHeatmap({
  entries,
  players,
}: {
  entries: RevenueRankConversionEntry[];
  players: Player[];
}) {
  const entryByMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  return (
    <div className="grid w-full max-w-full min-w-0 gap-3 lg:grid-cols-2">
      {players.map((player, index) => {
        const entry = entryByMember.get(player.memberId);
        return (
          <RevenueRankConversionPlayerMatrix
            entry={entry}
            index={index}
            key={player.memberId}
            player={player}
          />
        );
      })}
    </div>
  );
}

function PlayOrderHeatmapPlayerRow({
  index,
  maxValue,
  minValue,
  player,
  row,
}: {
  index: number;
  maxValue: number | undefined;
  minValue: number | undefined;
  player: Player;
  row: PlayOrderHeatmapRow | undefined;
}) {
  const cellsByPlayOrder = new Map((row?.cells ?? []).map((cell) => [cell.playOrder, cell]));
  return (
    <>
      <div
        className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-sm font-semibold break-words text-[var(--color-text-primary)]"
        style={{ borderLeftColor: playerColor(index), borderLeftWidth: 3 }}
      >
        {player.displayName}
      </div>
      {[1, 2, 3, 4].map((playOrder) => {
        const cell = cellsByPlayOrder.get(playOrder);
        const rankAverage = cell?.rankAverage;
        const hasValue = isFiniteNumber(rankAverage) && (cell?.matchCount ?? 0) > 0;
        return (
          <div
            aria-label={`${player.displayName} ${formatPlayOrderLabel(playOrder)} 平均順位 ${formatDecimal(rankAverage)} ${cell?.matchCount ?? 0}戦`}
            className="rounded-[var(--radius-xs)] border px-2 py-2 text-center"
            key={playOrder}
            role="img"
            style={{
              backgroundColor: hasValue
                ? rankAverageTone(rankAverage, minValue, maxValue)
                : "var(--color-surface)",
              borderColor: hasValue
                ? "color-mix(in srgb, var(--color-tray-incident) 28%, transparent)"
                : "var(--color-border)",
            }}
          >
            <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
              {formatDecimal(rankAverage)}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
              {cell?.matchCount ?? 0}戦
            </div>
          </div>
        );
      })}
    </>
  );
}

function RevenueRankConversionPlayerMatrix({
  entry,
  index,
  player,
}: {
  entry: RevenueRankConversionEntry | undefined;
  index: number;
  player: Player;
}) {
  const rows = entry?.rows ?? [];
  return (
    <div className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div
        className="mb-3 text-sm font-semibold break-words text-[var(--color-text-primary)]"
        style={{ borderLeftColor: playerColor(index), borderLeftWidth: 3, paddingLeft: 8 }}
      >
        {player.displayName}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">対象データなし</p>
      ) : (
        <div className="max-w-full min-w-0 overflow-x-auto pb-1">
          <div
            className="grid w-full min-w-0 gap-1"
            style={{
              gridTemplateColumns: "minmax(3.25rem, 0.85fr) repeat(4, minmax(3rem, 1fr))",
            }}
          >
            <div aria-hidden="true" />
            {[1, 2, 3, 4].map((rank) => (
              <div
                className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-1 text-center text-[11px] leading-4 font-semibold text-[var(--color-text-primary)]"
                key={rank}
              >
                最終{rank}位
              </div>
            ))}
            {rows.map((row) => (
              <RevenueRankConversionRow key={row.revenueRank} player={player} row={row} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RevenueRankConversionRow({
  player,
  row,
}: {
  player: Player;
  row: RevenueRankConversionEntry["rows"][number];
}) {
  return (
    <>
      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-2 text-[11px] leading-4 font-semibold text-[var(--color-text-primary)]">
        収益{formatRevenueRank(row.revenueRank)}
        <div className="mt-0.5 text-[10px] font-normal text-[var(--color-text-secondary)] tabular-nums">
          {row.targetCount}戦
        </div>
      </div>
      {row.finalRankCounts.map((item) => (
        <motion.div
          aria-label={`${player.displayName}、物件収益${formatRevenueRank(row.revenueRank)}、最終${item.rank}位 ${item.count}回 ${formatPercent(item.rate)}`}
          className="rounded-[var(--radius-xs)] border px-1 py-2 text-center"
          key={item.rank}
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          role="img"
          style={{
            backgroundColor:
              item.count > 0
                ? rankBackgroundColor(item.rank, item.rate ?? 0)
                : "var(--color-surface)",
            borderColor: item.count > 0 ? rankBorderColor(item.rank) : "var(--color-border)",
          }}
          transition={momoTransition}
        >
          <div className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
            {item.count}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)] tabular-nums">
            {formatPercent(item.rate)}
          </div>
        </motion.div>
      ))}
    </>
  );
}

function formatRevenueRank(rank: number): string {
  return Number.isInteger(rank) ? `${rank}位` : `同値${rank.toFixed(1)}位`;
}
