import { Fragment } from "react";

import {
  formatDecimal,
  formatPercent,
  headToHeadSignalLabel,
  intensityClassName,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { SeriesComparisonAggregateV2 } from "@/shared/api/seriesAnalysis";
import { dataVizSeriesColor } from "@/shared/ui/dataViz/playerSeries";
import { rankColor } from "@/shared/ui/rank/rankPresentation";

type OverviewChartProps = {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV2;
};

export function RankDistributionBars({ focusedItemIds, response }: OverviewChartProps) {
  return (
    <div className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {[1, 2, 3, 4].map((rank) => (
          <span className="inline-flex items-center gap-2" key={rank}>
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: rankColor(rank) }}
            />
            {rank}位
          </span>
        ))}
      </div>
      <div className="grid gap-2">
        {response.players.map((player, playerIndex) => {
          const entry = response.rankDistribution.find(
            (candidate) => candidate.memberId === player.memberId,
          );
          return (
            <div
              className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)_4rem] sm:items-center"
              key={player.memberId}
            >
              <div
                className="text-sm font-semibold break-words"
                style={{
                  borderLeftColor: dataVizSeriesColor(playerIndex),
                  borderLeftWidth: 3,
                  paddingLeft: 8,
                }}
              >
                {player.displayName}
              </div>
              <div
                aria-label={`${player.displayName}の順位分布`}
                className="flex h-9 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface)]"
                role="img"
              >
                {entry?.cells.map((cell) => (
                  <span
                    aria-label={`${cell.rank}位 ${cell.count}回 ${formatPercent(cell.rate)}${focusedItemIds.includes(cell.itemId) ? "、この試合" : ""}`}
                    data-focused-metric={focusedItemIds.includes(cell.itemId) ? "true" : undefined}
                    key={cell.itemId}
                    style={{
                      backgroundColor: rankColor(cell.rank),
                      flexBasis: `${(cell.rate ?? 0) * 100}%`,
                      flexGrow: 0,
                      flexShrink: 0,
                      outline: focusedItemIds.includes(cell.itemId)
                        ? "2px solid var(--color-action)"
                        : undefined,
                      outlineOffset: focusedItemIds.includes(cell.itemId) ? -2 : undefined,
                    }}
                  />
                ))}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)] tabular-nums sm:text-right">
                {entry?.total ?? 0}戦
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CrownShareBars({ response }: { response: SeriesComparisonAggregateV2 }) {
  return (
    <div className="grid gap-2">
      {response.players.map((player, index) => {
        const share = response.rankAnalysis.crownCertainty.shares.find(
          (candidate) => candidate.memberId === player.memberId,
        )?.share;
        return (
          <div
            className="grid grid-cols-[8rem_minmax(0,1fr)_4.5rem] items-center gap-2"
            key={player.memberId}
          >
            <span className="text-sm font-semibold break-words">{player.displayName}</span>
            <span className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]">
              <span
                className="block h-full rounded-full"
                style={{
                  backgroundColor: dataVizSeriesColor(index),
                  width: `${(share ?? 0) * 100}%`,
                }}
              />
            </span>
            <strong className="text-right text-sm tabular-nums">{formatPercent(share)}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function HeadToHeadMatrix({ response }: { response: SeriesComparisonAggregateV2 }) {
  const columnCount = response.players.length === 0 ? 1 : response.players.length;
  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="grid min-w-[42rem] gap-1"
        style={{ gridTemplateColumns: `9rem repeat(${columnCount}, minmax(7rem, 1fr))` }}
      >
        <div aria-hidden="true" />
        {response.players.map((player) => (
          <div
            className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-center text-xs font-semibold break-words"
            key={player.memberId}
          >
            vs {player.displayName}
          </div>
        ))}
        {response.players.map((subject, subjectIndex) => (
          <Fragment key={subject.memberId}>
            <div
              className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-2 text-sm font-semibold break-words"
              style={{
                borderLeftColor: dataVizSeriesColor(subjectIndex),
                borderLeftWidth: 3,
              }}
            >
              {subject.displayName}
            </div>
            {response.players.map((opponent) => {
              const entry = response.headToHead.entries.find(
                (candidate) =>
                  candidate.subjectMemberId === subject.memberId &&
                  candidate.opponentMemberId === opponent.memberId,
              );
              const self = subject.memberId === opponent.memberId;
              return (
                <div
                  className={`min-h-20 rounded-[var(--radius-xs)] border border-[var(--color-border)] px-2 py-2 text-center ${self ? "bg-[var(--color-surface-subtle)]" : intensityClassName(entry?.relativeIntensity ?? "none")}`}
                  key={opponent.memberId}
                >
                  {self ? (
                    <span className="text-xs text-[var(--color-text-muted)]">—</span>
                  ) : (
                    <>
                      <strong className="text-sm tabular-nums">
                        {formatPercent(entry?.betterRankRate)}
                      </strong>
                      <p className="mt-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
                        {headToHeadSignalLabel(entry?.signal)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
                        {entry?.betterRankCount ?? 0}/{entry?.matchCount ?? 0}戦・順位差
                        {formatDecimal(entry?.averageRankDiff)}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
