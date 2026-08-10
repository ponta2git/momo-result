import {
  CumulativeFormCharts,
  MomentumMatrices,
} from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import { MatchDigestStrip } from "@/features/seriesComparison/charts/SeriesAnalysisMatchDigest";
import { MatchNoInEventMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisMatchNoMatrix";
import { RecentRankStrips } from "@/features/seriesComparison/charts/SeriesAnalysisRecentRankStrip";
import { qualityLabel } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisFacts,
  AnalysisSection,
  AnalysisSubsection,
  playerName,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function FlowView({
  focusedItemIds,
  response,
  onDrilldown,
  onFocusMatch,
}: AnalysisViewProps & { onFocusMatch: (matchId: string) => void }) {
  const recentWindowSize = response.recentRanks[0]?.windowSize;
  const recentWindowTitle = recentWindowSize ? `直近${recentWindowSize}戦` : "直近順位";
  return (
    <div
      aria-labelledby={analysisTabId("flow")}
      className="grid gap-4"
      id={analysisPanelId("flow")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="flow" />
      <AnalysisSection id="metric-match-digest" title="最近の試合と荒れ方">
        <AnalysisFacts
          ariaLabel="最近の試合の対象範囲"
          items={[
            {
              id: "shown",
              label: "カード表示",
              value: `直近${response.matchDigest.shownCount}戦`,
            },
            {
              id: "total",
              label: "期間内",
              value: `全${response.matchDigest.totalCount}戦`,
            },
          ]}
        />
        <MatchDigestStrip
          focusedItemIds={focusedItemIds}
          response={response}
          onFocusMatch={onFocusMatch}
        />
      </AnalysisSection>
      <AnalysisSection id="metric-unexpected-wins" title="事前予測より上位で終えた勝利">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.rankAnalysis.unexpectedWinsByPlayer.map((entry) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={entry.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{playerName(response.players, entry.memberId)}</h3>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {qualityLabel(entry.status)}
                </span>
              </div>
              <p className="mt-2 text-sm tabular-nums">
                全{entry.totalWinCount}勝のうち {entry.unexpectedWinCount}戦
              </p>
              <Button
                className="mt-3"
                disabled={!entry.hasDetails}
                size="sm"
                variant="secondary"
                onClick={() =>
                  onDrilldown({ memberId: entry.memberId, metricId: "rankAnalysis.unexpectedWins" })
                }
              >
                対象試合を見る
              </Button>
            </article>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-recent-form" title="直近順位と累積推移">
        <AnalysisSubsection id="metric-recent-form-recent" title={recentWindowTitle}>
          <RecentRankStrips focusedItemIds={focusedItemIds} response={response} />
        </AnalysisSubsection>
        <div className="mt-6 border-t border-[var(--color-border)] pt-4">
          <AnalysisSubsection
            id="metric-recent-form-cumulative"
            meta={`${response.scope.matchCount}戦`}
            title="全試合の累積"
          >
            <CumulativeFormCharts focusedItemIds={focusedItemIds} response={response} />
          </AnalysisSubsection>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-momentum-switch" title="順位の切り替わり">
        <MomentumMatrices focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
      <AnalysisSection id="metric-match-no" title="開催内の第n試合傾向">
        <MatchNoInEventMatrix response={response} />
      </AnalysisSection>
    </div>
  );
}
