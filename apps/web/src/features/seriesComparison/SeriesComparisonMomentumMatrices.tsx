import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type {
  MomentumSwitchEntry,
  Player,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import { formatPercent } from "@/features/seriesComparison/seriesComparisonPresentation";
import { cn } from "@/shared/ui/cn";

type MomentumSwitchTransitionRow = NonNullable<MomentumSwitchEntry["transitionRows"]>[number];

export function MomentumTransitionMatrices({
  entriesByMember,
  players,
}: {
  entriesByMember: Map<string, MomentumSwitchEntry>;
  players: Player[];
}) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">順位遷移</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => (
          <MomentumTransitionMatrix
            entry={entriesByMember.get(player.memberId)}
            index={index}
            key={player.memberId}
            player={player}
          />
        ))}
      </div>
    </div>
  );
}

function MomentumTransitionMatrix({
  entry,
  index,
  player,
}: {
  entry: MomentumSwitchEntry | undefined;
  index: number;
  player: Player;
}) {
  const rows = [1, 2, 3, 4].map((previousRank) => momentumTransitionRow(entry, previousRank));
  return (
    <div
      className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
      style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
          {player.displayName}
        </span>
        <span className="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]">
          {entry?.transitionCount ?? 0}遷移
        </span>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div
          aria-label={`${player.displayName}の順位遷移`}
          className="grid min-w-[17rem] gap-1"
          style={{ gridTemplateColumns: "3.5rem repeat(4, minmax(2.8rem, 1fr))" }}
        >
          <div aria-hidden="true" />
          {[1, 2, 3, 4].map((rank) => (
            <div
              className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-center text-[11px] font-semibold text-[var(--color-text-secondary)]"
              key={`next-${rank}`}
            >
              次{rank}位
            </div>
          ))}
          {rows.map((row) => (
            <MomentumTransitionMatrixRow key={row.previousRank} row={row} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MomentumTransitionMatrixRow({ row }: { row: MomentumSwitchTransitionRow }) {
  return (
    <div className="contents">
      <div className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1">
        <div className="text-xs font-semibold text-[var(--color-text-primary)]">
          前{row.previousRank}位
        </div>
        <div className="text-[10px] leading-4 text-[var(--color-text-secondary)]">
          {row.targetCount}件
        </div>
      </div>
      {[1, 2, 3, 4].map((nextRank) => {
        const cell = momentumTransitionCell(row, nextRank);
        return (
          <div
            className={cn(
              "rounded-[var(--radius-xs)] border px-1.5 py-1 text-center tabular-nums",
              momentumTransitionCellClass(cell.count, cell.rate),
            )}
            key={`cell-${row.previousRank}-${nextRank}`}
          >
            <div className="text-sm font-semibold">{cell.count}</div>
            <div className="text-[10px] leading-4">{formatPercent(cell.rate)}</div>
          </div>
        );
      })}
    </div>
  );
}

function momentumTransitionRow(
  entry: MomentumSwitchEntry | undefined,
  previousRank: number,
): MomentumSwitchTransitionRow {
  return (
    (entry?.transitionRows ?? []).find((row) => row.previousRank === previousRank) ?? {
      cells: [1, 2, 3, 4].map((nextRank) => ({ count: 0, nextRank })),
      previousRank,
      status: "no_target",
      targetCount: 0,
    }
  );
}

function momentumTransitionCell(row: MomentumSwitchTransitionRow, nextRank: number) {
  return (
    (row.cells ?? []).find((cell) => cell.nextRank === nextRank) ?? {
      count: 0,
      nextRank,
    }
  );
}

function momentumTransitionCellClass(count: number, rate: number | null | undefined): string {
  if (count <= 0) {
    return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]";
  }
  if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0.5) {
    return "border-[var(--color-action)]/45 bg-[var(--color-action)]/12 text-[var(--color-text-primary)]";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]";
}
