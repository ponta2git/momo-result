import {
  AssetComparisonCards,
  StrategyProfileQuadrant,
} from "@/features/seriesComparison/charts/SeriesAnalysisAssetCards";
import {
  AssetRevenueHistograms,
  StrategyScatter,
} from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  formatHighlightValue,
  highlightMetricLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  rankSignalCandidateShareLabel,
  rankSignalLabel,
} from "@/features/seriesComparison/model/seriesAnalysisRankPresentation";
import {
  DestinationOutcomeSection,
  RevenueOutcomeSection,
} from "@/features/seriesComparison/page/SeriesAnalysisOutcomeSections";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisReadingGuide,
  AnalysisSection,
  memberNames,
  playerName,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { SeriesAnalysisQualityAdvisory } from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

export function DriversView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("drivers")}
      className="grid gap-4"
      id={analysisPanelId("drivers")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="drivers" />
      <AnalysisSection id="metric-money" title="資産の残し方">
        <AssetComparisonCards response={response} />
        <div className="mt-5">
          <AssetRevenueHistograms response={response} />
        </div>
        <div className="mt-5 border-t border-[var(--color-border)] pt-4">
          <h3 className="text-sm font-semibold">資産タイプの位置</h3>
          <div className="mt-3">
            <StrategyProfileQuadrant response={response} />
          </div>
        </div>
      </AnalysisSection>
      <RevenueOutcomeSection focusedItemIds={focusedItemIds} response={response} />
      <DestinationOutcomeSection response={response} />
      <AnalysisSection id="metric-strategy-scatter" title="試合ごとの資産と収益">
        <StrategyScatter focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {response.highlights.map((highlight) => (
            <div
              className="border-l-2 border-[var(--color-border)] px-3 py-2"
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
      <AnalysisSection id="metric-rank-signals" title="順位を読む追加の手掛かり">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {orderFixedMembers(response.rankAnalysis.rankSignalsByPlayer).map((entry) => (
            <article className="border-t border-[var(--color-border)] pt-3" key={entry.memberId}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">
                  <MemberSequenceLabel memberId={entry.memberId}>
                    {playerName(response.players, entry.memberId)}
                  </MemberSequenceLabel>
                </h3>
                <SeriesAnalysisQualityAdvisory status={entry.status} />
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
                        {rankSignalCandidateShareLabel(
                          candidate.candidateSharePercent,
                          entry.candidates.length,
                        )}
                        ・別開催で支持 {candidate.supportCount}組
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
        <div className="mt-4">
          <AnalysisReadingGuide
            ariaLabel="順位を読む追加の手掛かりの読み方"
            items={[
              {
                id: "decision",
                label: "候補の選び方",
                value: "候補内の比重と、別開催でも残った支持数を一緒に比べる",
              },
              {
                id: "next",
                label: "次に見る",
                value: "気になる候補の「検証範囲を見る」から、開催別の残り方と根拠試合を確かめる",
              },
              {
                id: "not-for",
                label: "使わない場面",
                value: "候補内の比重を、次戦の順位確率としては使わない",
              },
            ]}
          />
        </div>
      </AnalysisSection>
    </div>
  );
}
