import { Activity, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { RecentRankStrip } from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import {
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
  emphasisTextClass,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import { MomentumTransitionMatrices } from "@/features/seriesComparison/metrics/SeriesComparisonMomentumMatrices";
import type {
  MomentumSwitchEntry,
  MomentumSwitchRateKey,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
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
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { cn } from "@/shared/ui/cn";

export function RecentFormMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const recentByMember = recentFormMap(response);
  return (
    <MetricSection
      description="直近8戦の調子指標と順位推移です。3戦未満は参考です。"
      Icon={Activity}
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

export function MomentumSwitchMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const switchByMember = momentumSwitchMap(response);
  return (
    <MetricSection
      description="前戦順位から次戦順位への回復と下振れを示します。条件別率は8件未満なら参考です。"
      Icon={RefreshCw}
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
  const emphasis = momentumSwitchEmphasis(rate?.momentumSwitchSignal);
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
