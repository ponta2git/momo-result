import { ListChecks, Table2 } from "lucide-react";

import { RankSignalsDrilldownDialog } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankSignalsDrilldown";
import { useSeriesComparisonDrilldownUrlState } from "@/features/seriesComparison/drilldowns/useSeriesComparisonDrilldownUrlState";
import { PlayerMetricGrid } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  RankAnalysisMeta,
  RankAnalysisUnavailable,
} from "@/features/seriesComparison/metrics/SeriesComparisonRankAnalysisPrimitives";
import { metricsMap } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import {
  rankSignalDirectionLabel,
  rankSignalLabel,
  rankSignalStrengthLabel,
  stableRankSignals,
} from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";
import { Button } from "@/shared/ui/actions/Button";

export function RankSignalMetrics({ response }: { response: SeriesComparisonResponse }) {
  const analysis = response.rankAnalysis;
  const players = response.players ?? [];
  const byMember = new Map(
    (analysis.rankSignalsByPlayer ?? []).map((entry) => [entry.memberId, entry]),
  );
  const firstMemberId = (analysis.rankSignalsByPlayer ?? []).find(
    (entry) => stableRankSignals(entry.signals).length > 0,
  )?.memberId;
  const drilldown = useSeriesComparisonDrilldownUrlState({
    defaultView: "details",
    isView: (value): value is "details" => value === "details",
    kind: "rankSignals",
  });
  return (
    <MetricSection
      action={
        <Button
          className="text-xs"
          disabled={!firstMemberId}
          icon={<Table2 className="size-3.5" />}
          size="sm"
          variant="secondary"
          onClick={() => drilldown.open(firstMemberId)}
        >
          詳細
        </Button>
      }
      description="総資産を使わず、保存済み記録と期間内順位の安定した結びつきを開催回ごとに確かめます。勝因や次戦予測ではありません。"
      Icon={ListChecks}
      id="metric-rank-signals"
      title="順位を読む手掛かり"
    >
      {analysis.status === "no_target" ? (
        <RankAnalysisUnavailable analysis={analysis} />
      ) : (
        <>
          <RankAnalysisMeta analysis={analysis}>
            <span>開催を外した5回中{analysis.improvedFoldCount}回で読み取り改善</span>
          </RankAnalysisMeta>
          <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
            {(player) => {
              const entry = byMember.get(player.memberId);
              const signals = stableRankSignals(entry?.signals);
              return (
                <>
                  <RankAnalysisMeta analysis={analysis} status={entry?.status} />
                  {signals.length === 0 ? (
                    <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                      開催回をまたいで安定した手掛かりはありません。
                    </p>
                  ) : (
                    <ol className="grid gap-2">
                      {signals.map((signal, index) => (
                        <li
                          className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                          key={signal.signal}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                              {rankSignalLabel(signal.signal)}
                            </span>
                            <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
                              {rankSignalStrengthLabel(index)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                            {rankSignalDirectionLabel(signal)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              );
            }}
          </PlayerMetricGrid>
        </>
      )}
      {drilldown.selectedMemberId ? (
        <RankSignalsDrilldownDialog
          open
          response={response}
          selectedMemberId={drilldown.selectedMemberId}
          onMemberChange={drilldown.setMemberId}
          onOpenChange={(open) => {
            if (!open) drilldown.close();
          }}
        />
      ) : null}
    </MetricSection>
  );
}
