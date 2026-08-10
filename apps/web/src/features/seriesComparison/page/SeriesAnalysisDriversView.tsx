import {
  AssetComparisonCards,
  StrategyProfileQuadrant,
} from "@/features/seriesComparison/charts/SeriesAnalysisAssetCards";
import {
  AssetRevenueHistograms,
  RevenueConversionMatrices,
  StrategyScatter,
} from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  formatHighlightValue,
  formatPercent,
  highlightMetricLabel,
  qualityLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  memberNames,
  MetricValue,
  playerName,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function DriversView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("drivers")}
      className="grid gap-4"
      id={analysisPanelId("drivers")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="drivers" />
      <AnalysisSection
        description="各人の資産帯と、低資産・高資産になった試合での残り方を比べます。金額の大きさだけで勝因とは決めません。"
        id="metric-money"
        title="資産の残し方"
      >
        <AssetComparisonCards response={response} />
        <div className="mt-5">
          <AssetRevenueHistograms response={response} />
        </div>
        <div className="mt-5 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
          <h3 className="text-sm font-semibold">稼ぎ方の比重の根拠</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
            物件収益比率と順位スコアを4人の中央値で区切ります。近い点は同程度として扱います。
          </p>
          <div className="mt-3">
            <StrategyProfileQuadrant response={response} />
          </div>
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="物件収益順位から最終順位へどう移ったかを件数と行内割合で示します。強い色は、その収益順位の中で多かった着地です。"
        id="metric-revenue-outcome"
        title="物件収益と最終順位"
      >
        <RevenueConversionMatrices focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.metricsByPlayer.map((metric) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={metric.memberId}
            >
              <h3 className="font-semibold">{metric.displayName}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <MetricValue
                  label="収益上位時の勝率"
                  value={formatPercent(metric.revenueOutcome.top.winRate)}
                />
                <MetricValue
                  label="収益上位時の入賞率"
                  value={formatPercent(metric.revenueOutcome.top.podiumRate)}
                />
                <MetricValue
                  label="収益上位でも未勝利"
                  value={`${metric.nonRevenue.highRevenueNoWinCount}戦`}
                />
                <MetricValue
                  label="低収益時の入賞率"
                  value={formatPercent(metric.revenueOutcome.lowRevenue.podiumRate)}
                />
              </dl>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="目的地到着が多い試合・少ない試合・0回の試合で、勝率と入賞率がどう違うかを比べます。各枠の対象戦数を必ず併記します。"
        id="metric-destination-outcome"
        title="目的地到着と順位"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.metricsByPlayer.map((metric) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={metric.memberId}
            >
              <h3 className="font-semibold">{metric.displayName}</h3>
              <dl className="mt-3 grid gap-3 text-sm">
                <ConditionalOutcome
                  label="目的地到着が多い試合"
                  podiumRate={metric.destinationOutcome.top.podiumRate}
                  targetCount={metric.destinationOutcome.top.targetCount}
                  winRate={metric.destinationOutcome.top.winRate}
                />
                <ConditionalOutcome
                  label="目的地到着が少ない試合"
                  podiumRate={metric.destinationOutcome.lowDestination.podiumRate}
                  targetCount={metric.destinationOutcome.lowDestination.targetCount}
                  winRate={metric.destinationOutcome.lowDestination.winRate}
                />
                <ConditionalOutcome
                  label="目的地到着0回"
                  podiumRate={metric.destinationOutcome.zeroDestination.podiumRate}
                  targetCount={metric.destinationOutcome.zeroDestination.targetCount}
                  winRate={metric.destinationOutcome.zeroDestination.winRate}
                />
              </dl>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="1点は1人の1試合です。右ほど総資産に占める物件収益が大きく、上ほど総資産が大きい試合です。"
        id="metric-strategy-scatter"
        title="試合ごとの資産と収益"
      >
        <StrategyScatter focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {response.highlights.map((highlight) => (
            <div
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={highlight.highlightId}
            >
              <p className="text-xs text-[var(--color-text-secondary)]">
                {highlightMetricLabel(highlight.metricId)}
              </p>
              <p className="mt-1 font-semibold">
                {memberNames(response.players, highlight.leaderMemberIds)}
              </p>
              <p className="text-sm tabular-nums">
                {formatHighlightValue(highlight.metricId, highlight.value)}
              </p>
            </div>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="開催単位で分けた検証でも残った順位との関連候補です。因果関係や次戦の結果を保証するものではありません。"
        id="metric-rank-signals"
        title="順位を読む追加の手掛かり"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
                  この範囲では、繰り返し残る候補はありません。
                </p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {entry.candidates.map((candidate) => (
                    <li className="grid gap-0.5 text-sm" key={candidate.signal}>
                      <span className="font-medium">{rankSignalLabel(candidate.signal)}</span>
                      <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                        候補内の比重{" "}
                        {formatPercent(
                          candidate.candidateSharePercent === null
                            ? null
                            : candidate.candidateSharePercent / 100,
                        )}
                        ・支持 {candidate.supportCount}開催
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
                検証範囲を見る
              </Button>
            </article>
          ))}
        </div>
      </AnalysisSection>
    </div>
  );
}

function ConditionalOutcome({
  label,
  podiumRate,
  targetCount,
  winRate,
}: {
  label: string;
  podiumRate: number | null;
  targetCount: number;
  winRate: number | null;
}) {
  return (
    <div className="rounded-[var(--radius-xs)] bg-[var(--color-surface-subtle)] p-2">
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
        {targetCount}戦・勝率 {formatPercent(winRate)}・入賞率 {formatPercent(podiumRate)}
      </dd>
    </div>
  );
}
