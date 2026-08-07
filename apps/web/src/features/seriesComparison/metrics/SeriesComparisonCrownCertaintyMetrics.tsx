import { Crown } from "lucide-react";

import { playerColor } from "@/features/seriesComparison/charts/SeriesComparisonPlayerVisuals";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  RankAnalysisMeta,
  RankAnalysisUnavailable,
} from "@/features/seriesComparison/metrics/SeriesComparisonRankAnalysisPrimitives";
import { formatPercent } from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export function CrownCertaintyMetrics({ response }: { response: SeriesComparisonResponse }) {
  const analysis = response.rankAnalysis;
  const crown = analysis.crownCertainty;
  const shareByMember = new Map((crown.shares ?? []).map((share) => [share.memberId, share.share]));
  const players = response.players ?? [];
  return (
    <MetricSection
      description="開催回を組み替えて比べ直したとき、番手や保存済み記録を調整しても期間内首位として残った割合です。次戦の勝率ではありません。"
      Icon={Crown}
      id="metric-crown-certainty"
      title="王座の確からしさ"
    >
      {crown.status === "no_target" ? (
        <RankAnalysisUnavailable analysis={analysis} />
      ) : (
        <>
          <RankAnalysisMeta analysis={analysis} status={crown.status}>
            <span className="tabular-nums">
              {crown.successfulIterations}/{crown.bootstrapIterations}回を比較
            </span>
            <span className="tabular-nums">標本間の首位交代 {crown.leaderChangeCount}回</span>
          </RankAnalysisMeta>
          <div
            aria-label="王座支持の構成比"
            className="flex h-5 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
            role="img"
          >
            {players.map((player, index) => {
              const share = shareByMember.get(player.memberId) ?? 0;
              return (
                <span
                  aria-hidden="true"
                  key={player.memberId}
                  style={{ backgroundColor: playerColor(index), width: `${share * 100}%` }}
                />
              );
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {players.map((player, index) => (
              <div
                className="rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2"
                key={player.memberId}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: playerColor(index) }}
                  />
                  <span className="min-w-0 text-xs font-medium break-words text-[var(--color-text-secondary)]">
                    {player.displayName}
                  </span>
                </div>
                <p className="mt-1 text-base font-semibold text-[var(--color-text-primary)] tabular-nums">
                  {formatPercent(shareByMember.get(player.memberId))}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </MetricSection>
  );
}
