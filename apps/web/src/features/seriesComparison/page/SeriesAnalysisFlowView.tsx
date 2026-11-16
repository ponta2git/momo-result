import { memo } from "react";

import {
  SeriesTrendCharts,
  MomentumMatrices,
} from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import { MatchDigestStrip } from "@/features/seriesComparison/charts/SeriesAnalysisMatchDigest";
import { MatchNoInEventMatrix } from "@/features/seriesComparison/charts/SeriesAnalysisMatchNoMatrix";
import { RecentRankStrips } from "@/features/seriesComparison/charts/SeriesAnalysisRecentRankStrip";
import type { AnalysisViewProps } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import {
  AnalysisSection,
  AnalysisSubsection,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";

export const FlowView = memo(function FlowView({
  focusedItemIds,
  response,
  onFocusMatch,
}: AnalysisViewProps & { onFocusMatch: (matchId: string) => void }) {
  const matchIndexes = new Map<string, number>();
  for (const matches of [response.strategyScatter.points, response.matchDigest.recent]) {
    for (const match of matches) matchIndexes.set(match.matchId, match.matchIndex);
  }
  const recentWindowSize = response.recentRanks[0]?.windowSize;
  const recentWindowTitle = recentWindowSize ? `直近${recentWindowSize}戦` : "直近順位";
  const matchDigestTitle =
    response.matchDigest.shownCount > 0
      ? `直近${response.matchDigest.shownCount}戦と荒れ方`
      : "直近の試合と荒れ方";
  return (
    <div
      aria-labelledby={analysisTabId("flow")}
      className="grid gap-8"
      id={analysisPanelId("flow")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="flow" />
      <AnalysisSection id="metric-match-digest" title={matchDigestTitle}>
        <MatchDigestStrip
          focusedItemIds={focusedItemIds}
          players={response.players}
          digest={response.matchDigest}
          onFocusMatch={onFocusMatch}
        />
      </AnalysisSection>
      <AnalysisSection id="metric-recent-form" title="直近順位と累積推移">
        <div className="grid gap-6">
          <AnalysisSubsection id="metric-recent-form-recent" title={recentWindowTitle}>
            <RecentRankStrips
              focusedItemIds={focusedItemIds}
              players={response.players}
              recentRanks={response.recentRanks}
              matchIndexes={matchIndexes}
            />
          </AnalysisSubsection>
          <AnalysisSubsection
            id="metric-recent-form-cumulative"
            meta={`${response.scope.matchCount}戦`}
            title="全試合の累積"
          >
            <SeriesTrendCharts
              focusedItemIds={focusedItemIds}
              players={response.players}
              trends={response.trends}
              variant="form"
            />
          </AnalysisSubsection>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-momentum-switch" title="順位の切り替わり">
        <MomentumMatrices focusedItemIds={focusedItemIds} entries={response.momentumSwitch} />
      </AnalysisSection>
      <AnalysisSection id="metric-match-no" title="開催内の第n試合傾向">
        <MatchNoInEventMatrix
          entries={response.matchNoInEvent.entries}
          players={response.players}
        />
      </AnalysisSection>
    </div>
  );
});
