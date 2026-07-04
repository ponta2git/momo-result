import { RefreshCw, ShieldAlert, Table2 } from "lucide-react";
import { useState } from "react";

import { LineChart, PlayOrderHeatmap } from "@/features/seriesComparison/SeriesComparisonCharts";
import { MetricRow, PlayerMetricGrid } from "@/features/seriesComparison/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/SeriesComparisonMetricSection";
import { PlayOrderRankHistoryDrilldownDialog } from "@/features/seriesComparison/SeriesComparisonPlayOrderDrilldown";
import type { PlayerMetrics } from "@/features/seriesComparison/seriesComparisonPresentation";
import {
  formatDecimal,
  formatMoney,
  formatPercent,
  formatPlayOrderLabel,
  metricsMap,
  playOrderColor,
  playOrderHeatmapRows,
} from "@/features/seriesComparison/seriesComparisonPresentation";
import { playOrderSignal } from "@/features/seriesComparison/seriesComparisonViewModel";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";

export function PlayOrderMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  const [drilldownMemberId, setDrilldownMemberId] = useState<string | null>(null);
  return (
    <MetricSection
      action={
        <Button
          className="min-h-8 px-2.5 py-1 text-xs"
          disabled={players.length === 0}
          icon={<Table2 className="size-3.5" />}
          size="sm"
          variant="secondary"
          onClick={() => setDrilldownMemberId(players[0]?.memberId ?? null)}
        >
          履歴
        </Button>
      }
      description="1P〜4Pの番手別成績です。番手差が小さいほど、席順の影響が小さい状態です。"
      icon={<RefreshCw className="size-5" />}
      title="番手別成績"
      id="metric-play-order"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">番手別平均順位</h3>
        <PlayOrderHeatmap players={players} rows={playOrderHeatmapRows(response)} />
      </div>
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => <PlayOrderSignalRows metrics={metrics} />}
      </PlayerMetricGrid>
      <PlayOrderRankHistoryDrilldownDialog
        open={drilldownMemberId !== null}
        response={response}
        selectedMemberId={drilldownMemberId}
        onMemberChange={setDrilldownMemberId}
        onOpenChange={(open) => {
          if (!open) {
            setDrilldownMemberId(null);
          }
        }}
      />
    </MetricSection>
  );
}

function PlayOrderSignalRows({ metrics }: { metrics: PlayerMetrics | undefined }) {
  const signal = playOrderSignal(metrics);
  if (!signal.best || !signal.worst) {
    return <p className="text-sm text-[var(--color-text-secondary)]">対象データなし</p>;
  }
  return (
    <>
      <MetricRow label="得意番手" value={<PlayOrderValue item={signal.best} />} />
      <MetricRow label="苦手番手" value={<PlayOrderValue item={signal.worst} />} />
      <MetricRow
        help="番手別平均順位の最大値 - 最小値。大きいほど番手で成績差が出ています。"
        label="番手差"
        value={formatDecimal(signal.spread)}
      />
    </>
  );
}

function PlayOrderValue({
  item,
}: {
  item: NonNullable<PlayerMetrics["playOrder"]["breakdown"]>[number];
}) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-1.5 gap-y-0.5">
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: playOrderColor(item.playOrder) }}
        />
        {formatPlayOrderLabel(item.playOrder)}
      </span>
      <span className="font-medium text-[var(--color-text-secondary)]">
        平均順位 {formatDecimal(item.rankAverage)}、{item.matchCount}戦
      </span>
    </span>
  );
}

export function GinjiMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="スリの銀次は1回でも総資産を動かす事故です。2回以上の試合は分けて見ます。"
      icon={<ShieldAlert className="size-5" />}
      title="スリの銀次"
      id="metric-ginji"
    >
      <PlayerMetricGrid minColumnWidthRem={17} metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="被害回数" value={`${metrics?.ginji.count ?? 0}回`} />
            <MetricRow
              label="被害試合"
              value={`${metrics?.ginji.encounterMatches ?? 0}戦・${formatPercent(metrics?.ginji.encounterRate)}`}
            />
            <MetricRow
              label="2回以上の試合"
              value={`${metrics?.ginji.multiEncounterMatchCount ?? 0}戦`}
            />
            <MetricRow label="1試合最多" value={`${metrics?.ginji.maxInSingleMatch ?? 0}回`} />
            <MetricRow
              label="被害試合の平均順位"
              value={formatDecimal(metrics?.ginji.resilienceRankAverage)}
            />
            <MetricRow
              label="被害試合の平均総資産"
              value={formatMoney(metrics?.ginji.resilienceAssetsAverage)}
            />
            <MetricRow
              label="被害試合の平均物件収益"
              value={formatMoney(metrics?.ginji.resilienceRevenueAverage)}
            />
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="スリの銀次累計回数の推移グラフ"
        formatValue={(value) => `${value.toFixed(0)}回`}
        players={players}
        series={response.trends.ginjiCumulativeCount ?? []}
      />
    </MetricSection>
  );
}
