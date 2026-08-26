import { useEffect, useRef } from "react";

import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { rankColor, rankForegroundColor } from "@/shared/ui/rank/rankPresentation";

export function RecentRankStrips({
  focusedItemIds,
  response,
}: {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const entryByMemberId = new Map(response.recentRanks.map((entry) => [entry.memberId, entry]));
  const orderedEntries = orderFixedMembers(response.players).map((player) => ({
    entry: entryByMemberId.get(player.memberId),
    player,
  }));
  const axisRows = orderedEntries.find((row) => row.entry)?.entry?.rows ?? [];
  const focusedMatchIds = new Set(
    response.recentRanks.flatMap((entry) =>
      entry.rows.filter((row) => focusedItemIds.includes(row.itemId)).map((row) => row.matchId),
    ),
  );
  const matchIndexById = new Map<string, number>();
  for (const point of response.strategyScatter.points) {
    matchIndexById.set(point.matchId, point.matchIndex);
  }
  for (const match of response.matchDigest.recent) {
    matchIndexById.set(match.matchId, match.matchIndex);
  }
  const latestPointKey = axisRows.map((row) => row.matchId).join(":");

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [latestPointKey]);

  if (axisRows.length === 0) {
    return (
      <p className="py-3 text-sm text-[var(--color-text-secondary)]">
        直近順位の対象試合はありません。
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div
        aria-label="直近順位ストリップ横スクロール"
        className="w-full [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent] [scrollbar-gutter:stable] overflow-x-auto pb-2"
        ref={scrollContainerRef}
      >
        <table className="mx-auto w-max border-separate border-spacing-x-1 border-spacing-y-2">
          <caption className="sr-only">直近順位ストリップ</caption>
          <thead>
            <tr>
              <th
                className="sticky left-0 z-[var(--z-sticky)] w-40 min-w-40 bg-[var(--color-surface)] pr-2 align-bottom"
                scope="col"
              >
                <span className="sr-only">プレーヤー</span>
              </th>
              {axisRows.map((row, pointIndex) => {
                const matchIndex = matchIndexById.get(row.matchId);
                const focused = focusedMatchIds.has(row.matchId);
                const showMarker =
                  focused ||
                  shouldShowRankStripMatchMarker(matchIndex, pointIndex, axisRows.length);
                return (
                  <th
                    className={`w-11 min-w-11 px-0 text-center align-bottom ${focused ? "w-14 min-w-14" : ""}`}
                    key={row.matchId}
                    scope="col"
                  >
                    {showMarker ? (
                      <SeriesAnalysisMatchLink
                        ariaLabel={`${formatSeriesMatchIndex(matchIndex)}の試合結果を見る${focused ? "、この試合" : ""}`}
                        className={`justify-center text-[11px] whitespace-nowrap ${focused ? "momo-enter" : "text-[var(--color-text-muted)]"}`}
                        matchId={row.matchId}
                      >
                        {focused ? "この試合" : formatSeriesMatchIndex(matchIndex)}
                      </SeriesAnalysisMatchLink>
                    ) : (
                      <span aria-hidden="true" className="block h-11" />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {orderedEntries.map(({ entry, player }) => {
              const rowsByMatchId = new Map((entry?.rows ?? []).map((row) => [row.matchId, row]));
              return (
                <tr key={player.memberId}>
                  <th
                    className="sticky left-0 z-[var(--z-base)] w-40 min-w-40 bg-[var(--color-surface)] py-1 pr-2 pl-2 text-left align-middle"
                    scope="row"
                  >
                    <span className="block text-sm leading-5 font-semibold break-words">
                      <MemberSequenceLabel memberId={player.memberId}>
                        {player.displayName}
                      </MemberSequenceLabel>
                    </span>
                    <span className="block text-[11px] font-normal text-[var(--color-text-secondary)] tabular-nums">
                      平均{formatDecimal(entry?.averageRank)}位・入賞
                      {formatPercent(entry?.podiumRate)}
                    </span>
                    <SeriesAnalysisQualityAdvisory
                      className="mt-0.5"
                      status={entry?.qualityStatus ?? "no_target"}
                    />
                    {entry ? (
                      <span className="block text-[11px] font-normal text-[var(--color-text-secondary)] tabular-nums">
                        連勝 {entry.winStreak}・連続入賞 {entry.podiumStreak}・連続下位{" "}
                        {entry.lowerHalfStreak}
                      </span>
                    ) : null}
                  </th>
                  {axisRows.map((axisRow) => {
                    const row = rowsByMatchId.get(axisRow.matchId);
                    const matchIndex = matchIndexById.get(axisRow.matchId);
                    const focused = row ? focusedItemIds.includes(row.itemId) : false;
                    return (
                      <td className="h-11 w-11 min-w-11 px-0 align-middle" key={axisRow.matchId}>
                        {row ? (
                          <SeriesAnalysisMatchLink
                            ariaLabel={`${player.displayName}、${formatSeriesMatchIndex(matchIndex)}、${row.rank}位${focused ? "、この試合" : ""}。試合結果を見る`}
                            className={`size-11 justify-center overflow-hidden rounded-[var(--radius-xs)] border p-0 text-xs tabular-nums no-underline hover:no-underline ${focused ? "momo-enter ring-2 ring-[var(--color-action)] ring-offset-2 ring-offset-[var(--color-surface)]" : ""}`}
                            matchId={row.matchId}
                            style={{
                              backgroundColor: rankColor(row.rank),
                              borderColor: rankColor(row.rank),
                              color: rankForegroundColor(row.rank),
                            }}
                            title={`${formatSeriesMatchIndex(matchIndex)} ${row.rank}位`}
                          >
                            <span
                              className="grid size-full place-items-center rounded-[calc(var(--radius-xs)-1px)]"
                              data-focused-metric={focused ? "true" : undefined}
                            >
                              {row.rank}
                            </span>
                          </SeriesAnalysisMatchLink>
                        ) : (
                          <span aria-hidden="true" className="block size-11" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function shouldShowRankStripMatchMarker(
  matchIndex: number | undefined,
  pointIndex: number,
  pointCount: number,
): boolean {
  return (
    pointIndex === 0 ||
    pointIndex === pointCount - 1 ||
    (typeof matchIndex === "number" &&
      Number.isInteger(matchIndex) &&
      matchIndex > 0 &&
      matchIndex % 5 === 0)
  );
}
