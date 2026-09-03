import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import { SeriesAnalysisMatchLink } from "@/features/seriesComparison/navigation/SeriesAnalysisMatchLink";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { formatSeriesMatchIndex } from "@/shared/domain/matchLabels";
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
  const pinnedToLatestRef = useRef(true);
  const [scrollMetrics, setScrollMetrics] = useState({
    clientWidth: 0,
    scrollLeft: 0,
    scrollWidth: 0,
  });
  const entryByMemberId = new Map(response.recentRanks.map((entry) => [entry.memberId, entry]));
  const orderedEntries = response.players.map((player) => ({
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
  const maximumScrollLeft = Math.max(scrollMetrics.scrollWidth - scrollMetrics.clientWidth, 0);
  const scrollbarThumbWidth =
    scrollMetrics.scrollWidth > 0
      ? `${Math.min((scrollMetrics.clientWidth / scrollMetrics.scrollWidth) * 100, 100)}%`
      : "100%";

  const syncScrollMetrics = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    const next = {
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    };
    setScrollMetrics((current) =>
      current.clientWidth === next.clientWidth &&
      current.scrollLeft === next.scrollLeft &&
      current.scrollWidth === next.scrollWidth
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;

    pinnedToLatestRef.current = true;
    const alignLatest = () => {
      element.scrollLeft = element.scrollWidth;
      syncScrollMetrics();
    };
    const handleScroll = () => {
      pinnedToLatestRef.current =
        element.scrollWidth - element.clientWidth - element.scrollLeft <= 1;
      syncScrollMetrics();
    };
    const handleResize = () => {
      if (pinnedToLatestRef.current) element.scrollLeft = element.scrollWidth;
      syncScrollMetrics();
    };

    alignLatest();
    element.addEventListener("scroll", handleScroll, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => element.removeEventListener("scroll", handleScroll);
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(element);
    const table = element.firstElementChild;
    if (table) observer.observe(table);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", handleScroll);
    };
  }, [latestPointKey, syncScrollMetrics]);

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
        aria-label="直近順位"
        className="w-full [scrollbar-width:none] overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
        onScroll={syncScrollMetrics}
        ref={scrollContainerRef}
        role="region"
      >
        <table className="mx-auto w-max border-separate border-spacing-x-1 border-spacing-y-2">
          <caption className="sr-only">直近の試合順位</caption>
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
                        focused={focused}
                        matchId={row.matchId}
                        presentation="axis"
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
                    <span className="block text-xs font-normal text-[var(--color-text-secondary)] tabular-nums">
                      平均{formatDecimal(entry?.averageRank)}位・入賞
                      {formatPercent(entry?.podiumRate)}
                    </span>
                    <span className="mt-0.5 inline-flex empty:hidden">
                      <SeriesAnalysisQualityAdvisory status={entry?.qualityStatus ?? "no_target"} />
                    </span>
                    {entry ? (
                      <span className="block text-xs font-normal text-[var(--color-text-secondary)] tabular-nums">
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
                            colors={{
                              background: rankColor(row.rank),
                              border: rankColor(row.rank),
                              foreground: rankForegroundColor(row.rank),
                            }}
                            focused={focused}
                            matchId={row.matchId}
                            presentation="rank-cell"
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
      <input
        aria-label="直近順位を横スクロール"
        aria-valuetext={
          maximumScrollLeft > 0
            ? `${Math.round((scrollMetrics.scrollLeft / maximumScrollLeft) * 100)}%`
            : "すべて表示"
        }
        className="h-3 w-full cursor-ew-resize appearance-none bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] disabled:cursor-default disabled:opacity-100 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[var(--color-surface-selected)] [&::-webkit-slider-thumb]:-mt-0.5 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-[var(--recent-rank-scroll-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-solid [&::-webkit-slider-thumb]:border-[var(--color-surface)] [&::-webkit-slider-thumb]:bg-[var(--color-text-muted)]"
        disabled={maximumScrollLeft === 0}
        max={Math.max(maximumScrollLeft, 1)}
        min={0}
        onChange={(event) => {
          const element = scrollContainerRef.current;
          if (!element) return;
          element.scrollLeft = Number(event.currentTarget.value);
          syncScrollMetrics();
        }}
        style={
          {
            "--recent-rank-scroll-thumb-width": scrollbarThumbWidth,
          } as CSSProperties
        }
        type="range"
        value={Math.min(scrollMetrics.scrollLeft, maximumScrollLeft)}
      />
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
