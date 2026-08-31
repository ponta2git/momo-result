import { useId } from "react";

import {
  AnalysisMatrix,
  MatrixAxisHeader,
  MatrixCell,
  MatrixColumnHeader,
  MatrixRowHeader,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
import {
  formatDecimal,
  formatPercent,
  headToHeadSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { RelativeIntensity, SeriesComparisonAggregateV3 } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";
import { dataVizSeriesPresentation } from "@/shared/ui/dataViz/seriesPresentation";
import { colorMix, rankColor } from "@/shared/ui/rank/rankPresentation";

type OverviewChartProps = {
  focusedItemIds: readonly string[];
  response: SeriesComparisonAggregateV3;
};

const STACKED_SEGMENT_SEPARATOR = "inset 1px 0 var(--color-chart-segment-separator)";

export function RankDistributionBars({ focusedItemIds, response }: OverviewChartProps) {
  const titleId = useId();
  const players = response.players;
  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <h3 className="text-sm font-semibold" id={titleId}>
        各順位の回数
      </h3>
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
        {players.map((player) => {
          const entry = response.rankDistribution.find(
            (candidate) => candidate.memberId === player.memberId,
          );
          return (
            <div
              aria-label={`${player.displayName}の順位回数`}
              className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)_4rem] sm:items-center"
              key={player.memberId}
            >
              <div className="text-sm font-semibold break-words">
                <MemberSequenceLabel memberId={player.memberId}>
                  {player.displayName}
                </MemberSequenceLabel>
              </div>
              <div
                aria-label={`${player.displayName}の順位分布`}
                className="flex h-9 overflow-hidden rounded-[var(--radius-xs)] bg-[var(--color-surface)]"
                role="group"
              >
                {entry?.cells.map((cell, cellIndex) => (
                  <span
                    aria-label={`${cell.rank}位 ${cell.count}回 ${formatPercent(cell.rate)}${focusedItemIds.includes(cell.itemId) ? "、この試合" : ""}`}
                    data-focused-metric={focusedItemIds.includes(cell.itemId) ? "true" : undefined}
                    key={cell.itemId}
                    role="img"
                    style={{
                      backgroundColor: rankColor(cell.rank),
                      flexBasis: `${(cell.rate ?? 0) * 100}%`,
                      flexGrow: 0,
                      flexShrink: 0,
                      boxShadow: cellIndex === 0 ? undefined : STACKED_SEGMENT_SEPARATOR,
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
              <p className="text-sm leading-5 font-medium text-[var(--color-text-primary)] tabular-nums sm:col-start-2 sm:col-end-4">
                {rankCountSummary(entry?.cells ?? [], focusedItemIds)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function rankCountSummary(
  cells: ReadonlyArray<{ count: number; itemId: string; rank: number }>,
  focusedItemIds: readonly string[],
): string {
  const countByRank = new Map(cells.map((cell) => [cell.rank, cell.count]));
  const focusedRanks = new Set(
    cells.filter((cell) => focusedItemIds.includes(cell.itemId)).map((cell) => cell.rank),
  );
  return [1, 2, 3, 4]
    .map(
      (rank) =>
        `${rank}位 ${countByRank.get(rank) ?? 0}回${focusedRanks.has(rank) ? "（この試合）" : ""}`,
    )
    .join("・");
}

export function CrownShareBars({ response }: { response: SeriesComparisonAggregateV3 }) {
  const players = response.players;
  const shareByMemberId = new Map(
    response.rankAnalysis.crownCertainty.shares.map((entry) => [entry.memberId, entry.share]),
  );
  const chartLabel = players
    .map((player) => `${player.displayName} ${formatPercent(shareByMemberId.get(player.memberId))}`)
    .join("、");
  return (
    <div className="grid gap-3">
      <div
        aria-label={`平均順位首位に残った比率。${chartLabel}`}
        className="flex h-3 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]"
        role="img"
      >
        {players.map((player, playerIndex) => {
          const share = shareByMemberId.get(player.memberId) ?? 0;
          return (
            <span
              aria-hidden="true"
              className="block h-full"
              key={player.memberId}
              style={{
                backgroundColor: dataVizSeriesPresentation(player.memberId).color,
                boxShadow: playerIndex === 0 ? undefined : STACKED_SEGMENT_SEPARATOR,
                flexBasis: `${share * 100}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>
      <dl className="grid gap-px overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 xl:grid-cols-4">
        {players.map((player) => {
          const share = shareByMemberId.get(player.memberId);
          return (
            <div
              className="flex items-center justify-between gap-2 bg-[var(--color-surface)] px-3 py-2"
              key={player.memberId}
            >
              <dt className="text-sm font-semibold break-words">
                <MemberSequenceLabel memberId={player.memberId}>
                  {player.displayName}
                </MemberSequenceLabel>
              </dt>
              <dd className="text-right text-sm font-semibold tabular-nums">
                {formatPercent(share)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function HeadToHeadMatrix({ response }: { response: SeriesComparisonAggregateV3 }) {
  const players = response.players;
  return (
    <AnalysisMatrix ariaLabel="直接対決" className="min-w-[42rem] table-fixed">
      <thead>
        <tr>
          <MatrixAxisHeader className="w-36" columnLabel="相手" rowLabel="本人" />
          {players.map((player) => (
            <MatrixColumnHeader key={player.memberId}>
              <MemberSequenceLabel className="justify-center" memberId={player.memberId}>
                vs {player.displayName}
              </MemberSequenceLabel>
            </MatrixColumnHeader>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((subject) => (
          <tr key={subject.memberId}>
            <MatrixRowHeader>
              <MemberSequenceLabel memberId={subject.memberId}>
                {subject.displayName}
              </MemberSequenceLabel>
            </MatrixRowHeader>
            {players.map((opponent) => {
              const entry = response.headToHead.entries.find(
                (candidate) =>
                  candidate.subjectMemberId === subject.memberId &&
                  candidate.opponentMemberId === opponent.memberId,
              );
              const self = subject.memberId === opponent.memberId;
              return (
                <MatrixCell
                  aria-label={
                    self
                      ? `${subject.displayName}本人`
                      : `${subject.displayName}対${opponent.displayName}、上位率${formatPercent(entry?.betterRankRate)}、${headToHeadSignalLabel(entry?.signal)}、${entry?.matchCount ?? 0}戦中${entry?.betterRankCount ?? 0}戦上位、平均順位差${formatDecimal(entry?.averageRankDiff)}`
                  }
                  className="h-20 rounded-[var(--radius-xs)] border px-2 py-2 text-center"
                  key={opponent.memberId}
                  style={
                    self
                      ? {
                          backgroundColor: "var(--color-surface-subtle)",
                          borderColor: "var(--color-border)",
                        }
                      : headToHeadCellStyle(entry?.signal, entry?.relativeIntensity ?? "none")
                  }
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
                </MatrixCell>
              );
            })}
          </tr>
        ))}
      </tbody>
    </AnalysisMatrix>
  );
}

export function headToHeadCellStyle(
  signal: string | undefined,
  intensity: RelativeIntensity,
): { backgroundColor: string; borderColor: string } {
  const alpha = intensityAlpha(intensity);
  const color = signal?.includes("disadvantage")
    ? "var(--color-analysis-negative)"
    : signal?.includes("advantage")
      ? "var(--color-analysis-positive)"
      : "var(--color-tray-incident)";
  const borderAlpha = alpha + 0.18 > 0.62 ? 0.62 : alpha + 0.18;
  return {
    backgroundColor: colorMix(color, alpha),
    borderColor: colorMix(color, borderAlpha),
  };
}

function intensityAlpha(intensity: RelativeIntensity): number {
  switch (intensity) {
    case "high":
      return 0.32;
    case "medium":
      return 0.2;
    case "low":
      return 0.11;
    case "none":
      return 0.06;
  }
}
