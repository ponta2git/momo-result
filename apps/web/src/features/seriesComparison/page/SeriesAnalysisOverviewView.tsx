import {
  formatDecimal,
  formatManYen,
  formatPercent,
  intensityClassName,
  profileLabel,
  qualityLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  memberNames,
  playerName,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function OverviewView({ response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("overview")}
      className="grid gap-4"
      id={analysisPanelId("overview")}
      role="tabpanel"
    >
      <AnalysisSection
        id="metric-basic"
        title="順位と基礎比較"
        description={`首位: ${memberNames(response.players, response.summary.leaderMemberIds)} / 平均順位差 ${formatDecimal(response.summary.averageRankSpread)}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>プレーヤー</TableHead>
                <TableHead>平均順位</TableHead>
                <TableHead>順位ぶれ</TableHead>
                <TableHead>入賞</TableHead>
                <TableHead>下位</TableHead>
                <TableHead>平均総資産</TableHead>
                <TableHead>平均収益</TableHead>
                <TableHead>詳細</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.metricsByPlayer.map((metric) => (
                <tr className="border-t border-[var(--color-border)]" key={metric.memberId}>
                  <TableCell>
                    <strong>{metric.displayName}</strong>
                  </TableCell>
                  <TableCell>{formatDecimal(metric.rank.average)}位</TableCell>
                  <TableCell>{formatDecimal(metric.rank.standardDeviation)}</TableCell>
                  <TableCell>{formatPercent(metric.podium.rate)}</TableCell>
                  <TableCell>{formatPercent(metric.lowerHalf.rate)}</TableCell>
                  <TableCell>{formatManYen(metric.assets.average)}</TableCell>
                  <TableCell>{formatManYen(metric.revenue.average)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        onDrilldown({ memberId: metric.memberId, metricId: "rank.averageHistory" })
                      }
                    >
                      推移
                    </Button>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-rank-distribution" title="順位分布">
        <div className="grid gap-3 md:grid-cols-2">
          {response.rankDistribution.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{entry.displayName}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {entry.total}戦・{qualityLabel(entry.qualityStatus)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {entry.cells.map((cell) => (
                  <div
                    className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] px-2 py-2 text-center"
                    key={cell.itemId}
                  >
                    <p className="text-xs">{cell.rank}位</p>
                    <p className="mt-1 font-semibold tabular-nums">{cell.count}</p>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">
                      {formatPercent(cell.rate)}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        id="metric-crown-certainty"
        title="王座の確からしさ"
        description={`${response.rankAnalysis.crownCertainty.successfulIterations}/${response.rankAnalysis.crownCertainty.bootstrapIterations}回の有効反復`}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {response.rankAnalysis.crownCertainty.shares.map((share) => (
            <div
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={share.memberId}
            >
              <p className="text-sm font-semibold">
                {playerName(response.players, share.memberId)}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatPercent(share.share)}
              </p>
            </div>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-head-to-head" title="直接対決">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>本人</TableHead>
                <TableHead>相手</TableHead>
                <TableHead>対象</TableHead>
                <TableHead>上回った率</TableHead>
                <TableHead>平均順位差</TableHead>
                <TableHead>判定</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.headToHead.entries.map((entry) => (
                <tr
                  className={`border-t border-[var(--color-border)] ${intensityClassName(entry.relativeIntensity)}`}
                  key={entry.itemId}
                >
                  <TableCell>{playerName(response.players, entry.subjectMemberId)}</TableCell>
                  <TableCell>{playerName(response.players, entry.opponentMemberId)}</TableCell>
                  <TableCell>{entry.matchCount}戦</TableCell>
                  <TableCell>{formatPercent(entry.betterRankRate)}</TableCell>
                  <TableCell>{formatDecimal(entry.averageRankDiff)}</TableCell>
                  <TableCell>{entry.signal}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-rate" title="プレースタイルと安定性">
        <div className="grid gap-3 md:grid-cols-2">
          {response.performanceProfiles.entries.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <h3 className="font-semibold">{entry.displayName}</h3>
              <p className="mt-1 text-sm">
                {profileLabel(entry.profileKind)} / {profileLabel(entry.strategyKind)}
              </p>
              <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                順位ぶれ {formatDecimal(entry.rankStandardDeviation)}・順位スコア{" "}
                {formatDecimal(entry.averageRankScore)}・収益/資産{" "}
                {formatPercent(entry.averageRevenueAssetRate)}
              </p>
            </article>
          ))}
        </div>
      </AnalysisSection>
    </div>
  );
}
