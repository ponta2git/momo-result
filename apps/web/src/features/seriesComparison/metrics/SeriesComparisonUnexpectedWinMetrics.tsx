import { Sparkles } from "lucide-react";

import { PlayerMetricGrid } from "@/features/seriesComparison/metrics/SeriesComparisonMetricPrimitives";
import { MetricSection } from "@/features/seriesComparison/metrics/SeriesComparisonMetricSection";
import {
  RankAnalysisMeta,
  RankAnalysisUnavailable,
} from "@/features/seriesComparison/metrics/SeriesComparisonRankAnalysisPrimitives";
import {
  formatDecimal,
  formatMoney,
  metricsMap,
} from "@/features/seriesComparison/model/seriesComparisonPresentation";
import type { SeriesComparisonResponse } from "@/shared/api/seriesComparison";

export function UnexpectedWinMetrics({ response }: { response: SeriesComparisonResponse }) {
  const analysis = response.rankAnalysis;
  const players = response.players ?? [];
  const byMember = new Map(
    (analysis.unexpectedWinsByPlayer ?? []).map((entry) => [entry.memberId, entry]),
  );
  return (
    <MetricSection
      description="保存済み記録だけでは下位寄りに見えたのに、実際は1位だった試合です。運や隠れた実力を判定する指標ではありません。"
      Icon={Sparkles}
      id="metric-unexpected-wins"
      title="記録外の一撃"
    >
      {analysis.status === "no_target" ? (
        <RankAnalysisUnavailable analysis={analysis} />
      ) : (
        <PlayerMetricGrid metricsByMember={metricsMap(response)} players={players}>
          {(player) => {
            const entry = byMember.get(player.memberId);
            const latest = entry?.latest;
            return (
              <>
                <RankAnalysisMeta analysis={analysis} status={entry?.status} />
                <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] pb-2">
                  <span className="text-xs text-[var(--color-text-secondary)]">該当した1位</span>
                  <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                    {entry?.unexpectedWinCount ?? 0}/{entry?.totalWinCount ?? 0}勝
                  </span>
                </div>
                {latest ? (
                  <div className="grid gap-2 rounded-[var(--radius-xs)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs text-[var(--color-text-secondary)]">直近の一撃</span>
                      <span className="text-sm font-semibold text-[var(--color-text-primary)] tabular-nums">
                        推定{formatDecimal(latest.expectedRank, 1)}位 → 実際{latest.actualRank}位
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-[var(--color-text-secondary)] tabular-nums">
                      第{latest.matchNoInEvent}試合・物件収益{" "}
                      {formatMoney(latest.evidence.revenueManYen)}・目的地
                      {latest.evidence.destinationCount}回
                    </p>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                    この条件で該当した試合はありません。
                  </p>
                )}
              </>
            );
          }}
        </PlayerMetricGrid>
      )}
    </MetricSection>
  );
}
