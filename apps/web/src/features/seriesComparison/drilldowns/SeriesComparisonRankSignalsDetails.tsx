import type { RankSignalsDrilldownPayload } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankAnalysisDrilldownTypes";
import { RankSignalEvidenceCard } from "@/features/seriesComparison/drilldowns/SeriesComparisonRankSignalEvidence";
import {
  CandidateAdmissionCriteria,
  HeldEventTestMethod,
} from "@/features/seriesComparison/drilldowns/SeriesComparisonRankSignalMethod";
import { StatusBadge } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import {
  rankAnalysisAvailabilityText,
  rankSignalCandidateShares,
} from "@/features/seriesComparison/model/seriesComparisonRankAnalysis";
import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { Notice } from "@/shared/ui/feedback/Notice";

export function RankSignalsDetails({ payload }: { payload: RankSignalsDrilldownPayload }) {
  if (payload.status === "no_target") {
    return (
      <Notice title="この条件では対象外です" tone="info">
        {rankAnalysisAvailabilityText(payload)}
      </Notice>
    );
  }

  const allSignals = payload.signals ?? [];
  const signals = allSignals.filter((signal) => signal.stable).slice(0, 3);
  const candidateShares = rankSignalCandidateShares(signals);

  return (
    <>
      <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 sm:grid-cols-3">
        <DetailFact
          label="分析範囲"
          value={`${payload.heldEventCount}開催・${payload.matchCount}戦`}
        />
        <DetailFact
          label="全体の読み取り"
          value={`別開催5組中${payload.improvedFoldCount}組で改善`}
        />
        <div className="grid gap-1">
          <span className="text-xs text-[var(--color-text-secondary)]">品質</span>
          <div className="flex min-h-6 items-center gap-2">
            <StatusBadge status={payload.status} />
            {payload.status === "ok" ? (
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">安定</span>
            ) : null}
          </div>
        </div>
      </div>

      <HeldEventTestMethod
        foldRows={allSignals[0]?.foldRows ?? []}
        heldEventCount={payload.heldEventCount}
      />
      <CandidateAdmissionCriteria />

      {signals.length === 0 ? (
        <EmptyState
          description="開催を分けて確かめても繰り返し現れる候補はありません。"
          title="手掛かり候補なし"
        />
      ) : (
        <div className="grid gap-3">
          {signals.map((signal, index) => (
            <RankSignalEvidenceCard
              candidateCount={signals.length}
              candidateShare={candidateShares[index] ?? 0}
              index={index}
              key={signal.signal}
              signal={signal}
            />
          ))}
        </div>
      )}

      <p className="text-xs leading-5 text-pretty text-[var(--color-text-muted)]">
        手掛かり候補は保存済み記録と期間内順位の関係です。因果、次戦の勝率、ほかのプレーヤーより強いことは表しません。
      </p>
    </>
  );
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
      <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
        {value}
      </span>
    </div>
  );
}
