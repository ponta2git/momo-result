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
  rankSignalCandidateShares,
  rankSignalDirectionLabel,
  rankSignalLabel,
  rankSignalPriorityLabel,
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
      description="開催を分けて確かめても繰り返し現れた、保存済み記録と期間内順位の関係です。勝因や次戦予測ではありません。"
      Icon={ListChecks}
      id="metric-rank-signals"
      title="順位を読む手掛かり"
    >
      {analysis.status === "no_target" ? (
        <RankAnalysisUnavailable analysis={analysis} />
      ) : (
        <>
          <RankAnalysisMeta analysis={analysis}>
            <span>別開催テスト 5組中{analysis.improvedFoldCount}組で読み取り改善</span>
          </RankAnalysisMeta>
          <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
            {(player) => {
              const entry = byMember.get(player.memberId);
              const signals = stableRankSignals(entry?.signals);
              const candidateShares = rankSignalCandidateShares(signals);
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
                              {rankSignalPriorityLabel(index, signals.length)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-pretty text-[var(--color-text-secondary)]">
                            {rankSignalDirectionLabel(signal)}
                          </p>
                          {signals.length > 1 ? (
                            <CandidateShareBar
                              label={rankSignalLabel(signal.signal)}
                              share={candidateShares[index] ?? 0}
                            />
                          ) : null}
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

function CandidateShareBar({ label, share }: { label: string; share: number }) {
  return (
    <div
      aria-label={`${label}の候補内の比重 ${share}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={share}
      aria-valuetext={`${share}%、このプレーヤーの候補内で比較`}
      className="mt-2 grid gap-1"
      role="meter"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-muted)]">
        <span>候補内の比重</span>
        <span className="font-semibold tabular-nums">{share}%</span>
      </div>
      <div aria-hidden="true" className="h-1 overflow-hidden bg-[var(--color-surface-selected)]">
        <div className="h-full bg-[var(--color-text-secondary)]" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
