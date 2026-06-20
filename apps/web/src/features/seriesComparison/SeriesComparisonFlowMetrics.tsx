import { Activity, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { RecentRankStrip } from "@/features/seriesComparison/SeriesComparisonCharts";
import {
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
  emphasisTextClass,
} from "@/features/seriesComparison/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import { playerColor } from "@/features/seriesComparison/SeriesComparisonPlayerVisuals";
import type {
  MomentumSwitchEntry,
  MomentumSwitchRateKey,
  Player,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  formatCountRate,
  formatDecimal,
  formatPercent,
  formatSignedPercentPoint,
  metricsMap,
  momentumSwitchEmphasis,
  momentumSwitchMap,
  recentFormMap,
  recentRankStrips,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

export function RecentFormMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const recentByMember = recentFormMap(response);
  return (
    <MetricSection
      description="直近8戦の調子指標と順位推移です。3戦未満は参考です。"
      icon={<Activity className="size-5" />}
      title="直近の調子"
      id="metric-recent-form"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          直近順位ストリップ
        </h3>
        <RecentRankStrip entries={recentRankStrips(response)} players={players} />
      </div>
      <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
        {(player) => {
          const form = recentByMember.get(player.memberId);
          return (
            <>
              <div className="flex justify-end">
                <StatusBadge status={form?.status} />
              </div>
              <MetricRow
                label="平均順位"
                value={`${formatDecimal(form?.averageRank)}、${form?.targetCount ?? 0}戦`}
              />
              <MetricRow label="入賞率" value={formatPercent(form?.podiumRate)} />
              <MetricRow label="連勝" value={`${form?.winStreak ?? 0}戦`} />
              <MetricRow label="連続入賞" value={`${form?.podiumStreak ?? 0}戦`} />
              <MetricRow label="連続下位" value={`${form?.lowerHalfStreak ?? 0}戦`} />
            </>
          );
        }}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

type MomentumSwitchRate = MomentumSwitchEntry[MomentumSwitchRateKey];
type MomentumSwitchTransitionRow = NonNullable<MomentumSwitchEntry["transitionRows"]>[number];

export function MomentumSwitchMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const switchByMember = momentumSwitchMap(response);
  return (
    <MetricSection
      description="前戦の順位から次戦の順位へどう動いたかを見ます。条件別率は8件未満なら参考です。"
      icon={<RefreshCw className="size-5" />}
      title="切り替え力"
      id="metric-momentum-switch"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {players.map((player, index) => {
          const entry = switchByMember.get(player.memberId);
          return (
            <div
              className="min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3"
              key={player.memberId}
              style={{ borderTopColor: playerColor(index), borderTopWidth: 3 }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: playerColor(index) }}
                />
                <p className="min-w-0 text-sm font-semibold break-words text-[var(--color-text-primary)]">
                  {player.displayName}
                </p>
              </div>
              <div className="mt-3 grid gap-2">
                <div className="flex justify-end text-xs font-medium text-[var(--color-text-secondary)]">
                  {entry?.transitionCount ?? 0}遷移
                </div>
                <MomentumSwitchRateRow
                  kind="afterLower"
                  label="下位後入賞率"
                  rate={entry?.afterLower}
                />
                <MomentumSwitchRateRow
                  kind="afterFourth"
                  label="4位後入賞率"
                  rate={entry?.afterFourth}
                />
                <MomentumSwitchRateRow
                  kind="afterPodium"
                  label="入賞後下位率"
                  rate={entry?.afterPodium}
                />
              </div>
            </div>
          );
        })}
      </div>
      <MomentumTransitionMatrices entriesByMember={switchByMember} players={players} />
    </MetricSection>
  );
}

function MomentumSwitchRateRow({
  kind,
  label,
  rate,
}: {
  kind: MomentumSwitchRateKey;
  label: string;
  rate: MomentumSwitchRate | undefined;
}) {
  const emphasis = momentumSwitchEmphasis(kind, rate?.deltaFromBaseline, rate?.status);
  return (
    <MetricRow
      emphasis={emphasis}
      help={momentumSwitchHelp(kind)}
      label={label}
      status={rate?.status}
      value={
        <span className="inline-flex flex-col items-end gap-0.5">
          <span>
            {formatCountRate({
              count: rate?.successCount,
              rate: rate?.rate,
              targetCount: rate?.targetCount,
            })}
          </span>
          <span
            className={cn("text-[11px] font-medium leading-4", emphasisTextClass(emphasis?.kind))}
          >
            差 {formatSignedPercentPoint(rate?.deltaFromBaseline)}
          </span>
        </span>
      }
    />
  );
}

function momentumSwitchHelp(kind: MomentumSwitchRateKey): ReactNode {
  switch (kind) {
    case "afterFourth":
      return "前戦4位の次戦で1位か2位に入った割合です。差は本人全体の入賞率との差です。";
    case "afterPodium":
      return "前戦1位か2位の次戦で3位か4位になった割合です。差は本人全体の下位率との差です。";
    default:
      return "前戦3位か4位の次戦で1位か2位に入った割合です。差は本人全体の入賞率との差です。";
  }
}

function MomentumTransitionMatrices({
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
