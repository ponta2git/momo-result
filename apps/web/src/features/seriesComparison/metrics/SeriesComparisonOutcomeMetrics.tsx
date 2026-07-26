import { BadgeDollarSign, MapPinned } from "lucide-react";

import { RevenueRankConversionHeatmap } from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import {
  MetricRow,
  PlayerMetricGrid,
  StatusBadge,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  IntegratedMetricPanel,
  OutcomeDetails,
} from "@/features/seriesComparison/metrics/SeriesComparisonSectionPrimitives";
import type { PlayerMetrics } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  formatCountRate,
  formatPercent,
  formatSigned,
  metricsMap,
  rankOutcomeColor,
  revenueRankConversionEntries,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export type RankOutcome = PlayerMetrics["revenueOutcome"]["top"];

export function RevenueOutcomeMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="物件収益トップ時の1位率と、トップ外からの1位回数で、収益先行を勝ちに変えられた度合いを示します。"
      Icon={BadgeDollarSign}
      title="物件収益トップを勝ちにできたか"
      id="metric-revenue-outcome"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              help="その試合で物件収益が全員中トップだったとき、最終1位になった割合です。同値トップは全員をトップ扱いにします。"
              label="物件収益トップで1位"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.winCount,
                rate: metrics?.revenueOutcome.top.winRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              label="物件収益トップで入賞"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.podiumCount,
                rate: metrics?.revenueOutcome.top.podiumRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.revenueOutcome.top.status}
              label="物件収益トップで下位"
              value={formatCountRate({
                count: metrics?.revenueOutcome.top.lowerHalfCount,
                rate: metrics?.revenueOutcome.top.lowerHalfRate,
                targetCount: metrics?.revenueOutcome.top.targetCount,
              })}
            />
            <MetricRow
              help="物件収益トップではなかったのに最終1位だった試合数です。"
              label="物件収益トップ外で1位"
              value={`${metrics?.revenueOutcome.nonTopWinCount ?? 0}戦`}
            />
            <MetricRow
              help="物件収益順位が下位（平均順位方式で2.5より大きい）だった試合で、1・2位に入った割合です。"
              status={metrics?.revenueOutcome.lowRevenue.status}
              label="物件収益下位で入賞"
              value={formatCountRate({
                count: metrics?.revenueOutcome.lowRevenue.podiumCount,
                rate: metrics?.revenueOutcome.lowRevenue.podiumRate,
                targetCount: metrics?.revenueOutcome.lowRevenue.targetCount,
              })}
            />
            <RankOutcomeStrip
              label="物件収益トップ時の順位"
              outcome={metrics?.revenueOutcome.top}
              status={metrics?.revenueOutcome.top.status}
            />
            <OutcomeDetails title="詳しい内訳">
              <MetricRow
                help="各試合の「物件収益順位 - 最終順位」を平均。プラスなら、物件収益順位以上の最終順位を取っています。"
                label="物件収益順位との差"
                value={formatSigned(metrics?.nonRevenue.rankDelta)}
              />
              <MetricRow
                help="物件収益が全員中トップだった試合のうち、最終1位ではなかった割合です。"
                label="物件収益トップ未勝利"
                value={`${metrics?.nonRevenue.highRevenueNoWinCount ?? 0}/${metrics?.nonRevenue.highRevenueTopCount ?? 0}戦・${formatPercent(metrics?.nonRevenue.highRevenueNoWinRate)}`}
              />
            </OutcomeDetails>
          </>
        )}
      </PlayerMetricGrid>
      <IntegratedMetricPanel
        description="行は物件収益順位、列は最終順位です。同値の物件収益順位は平均順位方式の値として分けます。"
        title="物件収益順位から最終順位への転換"
      >
        <RevenueRankConversionHeatmap
          entries={revenueRankConversionEntries(response)}
          players={players}
        />
      </IntegratedMetricPanel>
    </MetricSection>
  );
}

export function DestinationOutcomeMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="目的地回数別の1位率・入賞率から、到着を順位へ変えられた度合いを示します。事件簿に残る目的地到着だけが対象です。"
      Icon={MapPinned}
      title="目的地到着を勝ちにできたか"
      id="metric-destination-outcome"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              help="目的地回数が全員中最多だった試合で、最終1位になった割合です。全員0回の試合は最多扱いにしません。"
              label="目的地最多で1位"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.winCount,
                rate: metrics?.destinationOutcome.top.winRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              label="目的地最多で入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.podiumCount,
                rate: metrics?.destinationOutcome.top.podiumRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              status={metrics?.destinationOutcome.top.status}
              label="目的地最多で下位"
              value={formatCountRate({
                count: metrics?.destinationOutcome.top.lowerHalfCount,
                rate: metrics?.destinationOutcome.top.lowerHalfRate,
                targetCount: metrics?.destinationOutcome.top.targetCount,
              })}
            />
            <MetricRow
              help="目的地順位が下位（平均順位方式で2.5より大きい）だった試合で、1・2位に入った割合です。"
              status={metrics?.destinationOutcome.lowDestination.status}
              label="目的地少なめで入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.lowDestination.podiumCount,
                rate: metrics?.destinationOutcome.lowDestination.podiumRate,
                targetCount: metrics?.destinationOutcome.lowDestination.targetCount,
              })}
            />
            <MetricRow
              help="目的地0回だった試合で、1・2位に入った割合です。"
              status={metrics?.destinationOutcome.zeroDestination.status}
              label="目的地0回で入賞"
              value={formatCountRate({
                count: metrics?.destinationOutcome.zeroDestination.podiumCount,
                rate: metrics?.destinationOutcome.zeroDestination.podiumRate,
                targetCount: metrics?.destinationOutcome.zeroDestination.targetCount,
              })}
            />
            <RankOutcomeStrip
              label="目的地最多時の順位"
              outcome={metrics?.destinationOutcome.top}
              status={metrics?.destinationOutcome.top.status}
            />
            <RankOutcomeStrip
              label="目的地0回時の順位"
              outcome={metrics?.destinationOutcome.zeroDestination}
              status={metrics?.destinationOutcome.zeroDestination.status}
            />
            <OutcomeDetails title="詳しい内訳">
              <MetricRow
                help="各試合の「目的地到着数順位 - 最終順位」を平均。プラスなら、目的地順位以上の最終順位を取っています。"
                label="目的地順位との差"
                value={formatSigned(metrics?.destination.conversionDelta)}
              />
              <MetricRow
                help="目的地到着数が上位の試合で得た順位点から、下位の試合で得た順位点を引いた値。順位点は「5 - 最終順位」です。"
                label="取れた日の成績差"
                value={formatSigned(metrics?.destination.dependenceScore)}
              />
            </OutcomeDetails>
          </>
        )}
      </PlayerMetricGrid>
    </MetricSection>
  );
}

function RankOutcomeStrip({
  label,
  outcome,
  status,
}: {
  label: string;
  outcome: RankOutcome | undefined;
  status?: string | null | undefined;
}) {
  const targetCount = outcome?.targetCount ?? 0;
  const distribution = outcome?.rankDistribution ?? [];
  return (
    <div className="grid gap-1.5 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex min-w-0 items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>
          <StatusBadge status={status} />
        </div>
        <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
          {targetCount > 0 ? `${targetCount}戦` : "対象なし"}
        </span>
      </div>
      {targetCount > 0 ? (
        <div
          aria-label={`${label}: ${distribution
            .map((item) => `${item.rank}位${item.count}回`)
            .join("、")}`}
          className="flex h-3 overflow-hidden rounded-full bg-[var(--color-surface-subtle)]"
          role="img"
        >
          {distribution.map((item) =>
            item.count > 0 ? (
              <span
                key={item.rank}
                aria-hidden="true"
                className="min-w-1"
                style={{
                  backgroundColor: rankOutcomeColor(item.rank),
                  flexGrow: item.count,
                }}
              />
            ) : null,
          )}
        </div>
      ) : (
        <div className="h-3 rounded-full bg-[var(--color-surface-subtle)]" />
      )}
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
        {distribution.map((item) => (
          <span key={item.rank} className="inline-flex items-center gap-1 tabular-nums">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: rankOutcomeColor(item.rank) }}
            />
            {item.rank}位 {item.count}回
          </span>
        ))}
      </div>
    </div>
  );
}
