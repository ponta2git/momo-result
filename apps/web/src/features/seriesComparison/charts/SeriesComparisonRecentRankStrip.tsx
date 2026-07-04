import { useEffect, useRef } from "react";

import type {
  Player,
  RecentRankStripEntry,
} from "@/features/seriesComparison/charts/SeriesComparisonChartTypes";
import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import {
  rankColor,
  rankForegroundColor,
} from "@/features/seriesComparison/charts/SeriesComparisonRankColors";
import { cn } from "@/shared/ui/cn";

export function RecentRankStrip({
  entries,
  players,
}: {
  entries: RecentRankStripEntry[];
  players: Player[];
}) {
  const entryByMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rows = players.map((player) => ({
    entry: entryByMember.get(player.memberId),
    player,
  }));
  const pointColumnCount = Math.max(0, ...rows.map((row) => row.entry?.points.length ?? 0));
  const matchMarkerPoints =
    rows.find((row) => (row.entry?.points.length ?? 0) === pointColumnCount)?.entry?.points ?? [];
  const hasPoints = pointColumnCount > 0;
  const hasReference = hasPoints && rows.some((row) => row.entry?.status === "reference");
  const commonStatus = hasPoints ? (hasReference ? "参考" : undefined) : "対象なし";
  const latestPointKey = entries
    .map((entry) => {
      const latestPoint = entry.points.at(-1);
      return [
        entry.memberId,
        latestPoint?.matchId ?? "",
        latestPoint?.matchIndex ?? "",
        entry.points.length,
        entry.windowSize,
      ].join(":");
    })
    .join("|");

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (element) {
      element.scrollLeft = element.scrollWidth;
    }
  }, [latestPointKey]);

  return (
    <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      {commonStatus ? (
        <div className="flex justify-end text-xs font-medium text-[var(--color-text-secondary)]">
          {commonStatus}
        </div>
      ) : null}
      {hasPoints ? (
        <section
          aria-label="直近順位ストリップ横スクロール"
          className="w-full [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] [scrollbar-gutter:stable] overflow-x-auto pb-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--color-border)] [&::-webkit-scrollbar-track]:bg-transparent"
          ref={scrollContainerRef}
        >
          <table
            aria-label="直近順位ストリップ"
            className="min-w-full border-separate border-spacing-x-1 border-spacing-y-2"
            style={{ width: "max-content" }}
          >
            <thead>
              <RecentRankStripMarkerRow
                pointColumnCount={pointColumnCount}
                points={matchMarkerPoints}
              />
            </thead>
            <tbody>
              {rows.map(({ entry, player }, index) => (
                <RecentRankStripPlayerRow
                  entry={entry}
                  index={index}
                  key={player.memberId}
                  player={player}
                  pointColumnCount={pointColumnCount}
                />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function RecentRankStripMarkerRow({
  pointColumnCount,
  points,
}: {
  pointColumnCount: number;
  points: RecentRankStripEntry["points"];
}) {
  return (
    <tr>
      <th
        className="sticky left-0 z-[var(--z-sticky)] w-28 max-w-28 min-w-28 bg-[var(--color-surface-subtle)] pr-2"
        scope="col"
      >
        <span className="sr-only">プレーヤー</span>
      </th>
      {Array.from({ length: pointColumnCount }, (_, pointIndex) => {
        const point = points[pointIndex];
        const showMarker =
          point && shouldShowRankStripMatchMarker(point.matchIndex, pointIndex, points.length);
        return (
          <th
            className="w-9 min-w-9 px-0 text-center align-bottom"
            key={point ? `${point.matchId}-${point.matchIndex}` : `marker-empty-${pointIndex}`}
            scope="col"
          >
            {point ? (
              <span
                className={cn(
                  "block h-3 whitespace-nowrap text-[0.625rem] font-medium leading-3 text-[var(--color-text-muted)] tabular-nums",
                  !showMarker && "invisible",
                )}
              >
                {point.matchIndex}戦
              </span>
            ) : (
              <span aria-hidden="true" className="block h-3" />
            )}
          </th>
        );
      })}
    </tr>
  );
}

function RecentRankStripPlayerRow({
  entry,
  index,
  player,
  pointColumnCount,
}: {
  entry: RecentRankStripEntry | undefined;
  index: number;
  player: Player;
  pointColumnCount: number;
}) {
  const points = entry?.points ?? [];

  return (
    <tr>
      <th
        className="sticky left-0 z-[var(--z-base)] w-28 max-w-28 min-w-28 bg-[var(--color-surface-subtle)] py-1 pr-2 text-left align-middle"
        scope="row"
        style={{ borderLeftColor: playerColor(index), borderLeftWidth: 3, paddingLeft: 8 }}
      >
        <span className="block min-w-0 text-sm leading-5 font-semibold break-words text-[var(--color-text-primary)]">
          {player.displayName}
        </span>
      </th>
      {Array.from({ length: pointColumnCount }, (_, pointIndex) => {
        const point = points[pointIndex];
        return (
          <td
            className="h-8 w-9 min-w-9 px-0 py-1 align-middle"
            key={point ? `${point.matchId}-${point.matchIndex}` : `empty-${pointIndex}`}
          >
            {point ? (
              <span className="grid w-9 grid-rows-[2rem] justify-items-center">
                <span
                  aria-label={`${player.displayName} ${point.matchIndex}戦目 ${point.rank}位`}
                  className="grid size-8 place-items-center rounded-[var(--radius-xs)] border text-xs font-semibold tabular-nums shadow-sm"
                  style={{
                    backgroundColor: rankColor(point.rank),
                    borderColor: rankColor(point.rank),
                    color: rankForegroundColor(point.rank),
                  }}
                  title={`${point.matchIndex}戦目 ${point.rank}位`}
                >
                  {point.rank}
                </span>
              </span>
            ) : (
              <span aria-hidden="true" className="block size-8" />
            )}
          </td>
        );
      })}
    </tr>
  );
}

export function shouldShowRankStripMatchMarker(
  matchIndex: number,
  pointIndex: number,
  pointCount: number,
): boolean {
  return (
    pointIndex === 0 ||
    pointIndex === pointCount - 1 ||
    (Number.isInteger(matchIndex) && matchIndex % 5 === 0)
  );
}
