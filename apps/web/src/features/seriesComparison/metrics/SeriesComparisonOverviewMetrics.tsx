import { BarChart3, Swords, Table2, Trophy } from "lucide-react";

import {
  HeadToHeadMatrix,
  LineChart,
  RankDistributionStackedBars,
} from "@/features/seriesComparison/charts/SeriesComparisonCharts";
import { RankAverageHistoryDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankDrilldown";
import { useSeriesComparisonDrilldownUrlState } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownUrlState";
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
import type { FocusedMatchMetricContext } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";
import { RankBadge } from "@/shared/ui/rank/RankBadge";

export function BasicMetrics({
  focusedIndex,
  focusedMatch,
  response,
}: {
  focusedIndex?: number | undefined;
  focusedMatch: FocusedMatchMetricContext;
  response: SeriesComparisonResponse;
}) {
  const players = response.players ?? [];
  const metricsByMember = metricsMap(response);
  const drilldown = useSeriesComparisonDrilldownUrlState({
    defaultView: "events",
    isView: (value): value is "events" | "matches" => value === "events" || value === "matches",
    kind: "rank",
  });
  return (
    <MetricSection
      action={
        <Button
          className="text-xs"
          disabled={players.length === 0}
          icon={<Table2 className="size-3.5" />}
          size="sm"
          variant="secondary"
          onClick={() => drilldown.open(players[0]?.memberId)}
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
        {(player, metrics) => {
          const focusedRank = focusedMatch.pointsByMember.get(player.memberId)?.rank;
          return (
            <>
              <MetricRow label="平均順位" value={formatDecimal(metrics?.rank.average)} />
              {(metrics?.rank.distribution ?? []).map((item) => (
                <MetricRow
                  focusedMatch={focusedRank === item.rank}
                  key={item.rank}
                  label={`${item.rank}位`}
                  value={
                    <span className="inline-flex items-center gap-2">
                      <RankBadge rank={item.rank} />
                      <span>
                        {item.count}回・{formatPercent(item.rate)}
                      </span>
                    </span>
                  }
                />
              ))}
            </>
          );
        }}
      </PlayerMetricGrid>
      <LineChart
        ariaLabel="平均順位の推移グラフ"
        domain={[1, 4]}
        focusedIndex={focusedIndex}
        formatValue={(value) => `${value.toFixed(0)}位`}
        lowValueAtTop
        players={players}
        series={response.trends.rankCumulativeAverage ?? []}
        yTicks={[1, 2, 3, 4]}
      />
      <RankAverageHistoryDrilldownDialog
        open={drilldown.selectedMemberId !== null}
        response={response}
        selectedMemberId={drilldown.selectedMemberId}
        view={drilldown.view}
        onMemberChange={drilldown.setMemberId}
        onOpenChange={(open) => {
          if (!open) drilldown.close();
        }}
        onViewChange={drilldown.setView}
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

export function RateMetrics({
  focusedIndex,
  response,
}: {
  focusedIndex?: number | undefined;
  response: SeriesComparisonResponse;
}) {
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
        focusedIndex={focusedIndex}
        formatValue={(value) => value.toFixed(2)}
        minYStep={0.25}
        players={players}
        series={response.trends.rankCumulativeStandardDeviation ?? []}
      />
    </MetricSection>
  );
}
