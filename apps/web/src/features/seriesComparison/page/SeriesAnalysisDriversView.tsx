import {
  formatDecimal,
  formatManYen,
  formatPercent,
  intensityClassName,
  profileLabel,
  qualityLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  HistogramTables,
  memberNames,
  MetricValue,
  playerName,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function DriversView({ response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("drivers")}
      className="grid gap-4"
      id={analysisPanelId("drivers")}
      role="tabpanel"
    >
      <AnalysisSection
        id="metric-rank-signals"
        title="順位を読む手掛かり"
        description={`モデル ${response.rankAnalysis.modelVersion} / ${response.rankAnalysis.matchCount}戦・${response.rankAnalysis.heldEventCount}開催`}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {response.rankAnalysis.rankSignalsByPlayer.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{playerName(response.players, entry.memberId)}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {qualityLabel(entry.status)}
                </span>
              </div>
              {entry.candidates.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">採用候補なし</p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {entry.candidates.map((candidate) => (
                    <li
                      className="flex items-center justify-between gap-2 text-sm"
                      key={candidate.signal}
                    >
                      <span>{rankSignalLabel(candidate.signal)}</span>
                      <span className="text-[var(--color-text-secondary)] tabular-nums">
                        {candidate.candidateSharePercent === null
                          ? formatDecimal(candidate.importance)
                          : `${candidate.candidateSharePercent}%`}
                        ・支持 {candidate.supportCount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                className="mt-3"
                disabled={entry.candidates.length === 0}
                size="sm"
                variant="secondary"
                onClick={() =>
                  onDrilldown({ memberId: entry.memberId, metricId: "rankAnalysis.rankSignals" })
                }
              >
                根拠を見る
              </Button>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-money" title="資産と勝ち筋">
        <div className="grid gap-3 md:grid-cols-2">
          {response.assetStyleProfiles.entries.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{entry.displayName}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {entry.targetCount}戦・{qualityLabel(entry.qualityStatus)}
                </span>
              </div>
              <p className="mt-1 text-sm">
                {profileLabel(entry.primaryKind)} / {entry.shapeKind ?? "—"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <MetricValue label="資産10%点" value={formatManYen(entry.metrics.p10Assets)} />
                <MetricValue label="中央値" value={formatManYen(entry.metrics.medianAssets)} />
                <MetricValue label="資産90%点" value={formatManYen(entry.metrics.p90Assets)} />
                <MetricValue label="低資産率" value={formatPercent(entry.metrics.lowAssetRate)} />
              </dl>
            </article>
          ))}
        </div>
        <HistogramTables response={response} />
      </AnalysisSection>
      <AnalysisSection id="metric-revenue-outcome" title="物件収益と勝ち">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>プレーヤー</TableHead>
                <TableHead>収益順位</TableHead>
                <TableHead>最終順位</TableHead>
                <TableHead>件数</TableHead>
                <TableHead>率</TableHead>
                <TableHead>同率</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.revenueRankConversion.map((entry) =>
                entry.cells.map((cell) => (
                  <tr
                    className={`border-t border-[var(--color-border)] ${intensityClassName(cell.relativeIntensity)}`}
                    key={cell.itemId}
                  >
                    <TableCell>{entry.displayName}</TableCell>
                    <TableCell>{cell.revenueRank}位</TableCell>
                    <TableCell>{cell.finalRank}位</TableCell>
                    <TableCell>{cell.count}</TableCell>
                    <TableCell>{formatPercent(cell.rate)}</TableCell>
                    <TableCell>{cell.hasRevenueTie ? "あり" : "なし"}</TableCell>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-destination-outcome" title="戦略散布と主要差">
        <p className="text-sm text-[var(--color-text-secondary)]">
          描画用に保存された {response.strategyScatter.points.length}{" "}
          点を、計算せずそのまま一覧化しています。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>試合</TableHead>
                <TableHead>プレーヤー</TableHead>
                <TableHead>順位</TableHead>
                <TableHead>総資産</TableHead>
                <TableHead>収益</TableHead>
                <TableHead>収益/資産</TableHead>
              </tr>
            </thead>
            <tbody>
              {response.strategyScatter.points.map((point) => (
                <tr className="border-t border-[var(--color-border)]" key={point.itemId}>
                  <TableCell>第{point.matchIndex}戦</TableCell>
                  <TableCell>{playerName(response.players, point.memberId)}</TableCell>
                  <TableCell>{point.rank}位</TableCell>
                  <TableCell>{formatManYen(point.totalAssetsManYen)}</TableCell>
                  <TableCell>{formatManYen(point.revenueManYen)}</TableCell>
                  <TableCell>{formatPercent(point.revenueAssetRate)}</TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {response.highlights.map((highlight) => (
            <div
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={highlight.highlightId}
            >
              <p className="text-xs text-[var(--color-text-secondary)]">{highlight.metricId}</p>
              <p className="mt-1 font-semibold">
                {memberNames(response.players, highlight.leaderMemberIds)}
              </p>
              <p className="text-sm tabular-nums">{formatDecimal(highlight.value)}</p>
            </div>
          ))}
        </div>
      </AnalysisSection>
    </div>
  );
}
