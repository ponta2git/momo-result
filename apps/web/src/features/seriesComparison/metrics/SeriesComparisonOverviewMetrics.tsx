import { BarChart3, Swords, Table2, Trophy } from "lucide-react";
import { useState } from "react";

import {
  HeadToHeadMatrix,
  LineChart,
  RankDistributionStackedBars,
} from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import { RankAverageHistoryDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldown";
import {
  MetricRow,
  PlayerMetricGrid,
} from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  formatDecimal,
  formatPercent,
  metricsMap,
  rankDistributionBars,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";

export function BasicMetrics({ response }: { response: SeriesComparisonResponse }) {
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
      description="平均順位は小さいほど上位です。順位ごとの回数は、勝ち切りと下位落ちの偏りを示します。"
      Icon={Trophy}
      title="順位の地力"
      id="metric-basic"
    >
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">順位分布</h3>
        <RankDistributionStackedBars entries={rankDistributionBars(response)} players={players} />
      </div>
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <>
            <MetricRow label="平均順位" value={formatDecimal(metrics?.rank.average)} />
            {(metrics?.rank.distribution ?? []).map((item) => (
              <MetricRow
                key={item.rank}
                label={`${item.rank}位`}
                value={`${item.count}回・${formatPercent(item.rate)}`}
              />
            ))}
          </>
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="平均順位の推移グラフ"
        domain={[1, 4]}
        formatValue={(value) => `${value.toFixed(0)}位`}
        lowValueAtTop
        players={players}
        series={response.trends.rankCumulativeAverage ?? []}
        yTicks={[1, 2, 3, 4]}
      />
      <RankAverageHistoryDrilldownDialog
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

export function HeadToHeadMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  return (
    <MetricSection
      description="行の社長が列の社長より上位だった割合です。件数が少ない相性は参考です。"
      Icon={Swords}
      title="直接対決"
      id="metric-head-to-head"
    >
      <HeadToHeadMatrix entries={response.headToHead.entries ?? []} players={players} />
    </MetricSection>
  );
}

export function RateMetrics({ response }: { response: SeriesComparisonResponse }) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  return (
    <MetricSection
      description="順位のブレ幅です。小さいほど同じ順位帯で安定しています。"
      Icon={BarChart3}
      title="安定性"
      id="metric-rate"
    >
      <PlayerMetricGrid metricsByMember={metricsByMember} players={players}>
        {(_, metrics) => (
          <MetricRow
            label="順位ブレ"
            help="平均順位からの標準偏差。小さいほど順位が安定しています。"
            value={formatDecimal(metrics?.stability.rankStandardDeviation)}
          />
        )}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="順位ブレの推移グラフ"
        formatValue={(value) => value.toFixed(2)}
        minYStep={0.25}
        players={players}
        series={response.trends.rankCumulativeStandardDeviation ?? []}
      />
    </MetricSection>
  );
}
