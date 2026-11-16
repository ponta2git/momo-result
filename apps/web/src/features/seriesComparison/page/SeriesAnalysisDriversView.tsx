import { memo } from "react";

import {
  AssetComparisonCards,
  StrategyProfileQuadrant,
} from "@/features/seriesComparison/charts/SeriesAnalysisAssetCards";
import {
  AssetRevenueHistograms,
  StrategyScatter,
} from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  memberNames,
  formatHighlightValue,
  highlightMetricLabel,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import { ExpectedRankGapSection } from "@/features/seriesComparison/page/SeriesAnalysisExpectedRankGapSection";
import {
  DestinationOutcomeSection,
  RevenueOutcomeSection,
} from "@/features/seriesComparison/page/SeriesAnalysisOutcomeSections";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

export const DriversView = memo(function DriversView({
  expectedRankGapMemberId,
  onExpectedRankGapMemberChange,
  focusedItemIds,
  response,
  onDrilldown,
}: AnalysisViewProps & {
  expectedRankGapMemberId?: string | undefined;
  onExpectedRankGapMemberChange?: ((memberId: string | undefined) => void) | undefined;
}) {
  return (
    <div
      aria-labelledby={analysisTabId("drivers")}
      className="grid gap-8"
      id={analysisPanelId("drivers")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="drivers" />
      <AnalysisSection id="metric-money" title="資産の残し方">
        <div className="grid gap-6">
          <AssetComparisonCards
            assetStyleProfiles={response.assetStyleProfiles}
            performanceProfiles={response.performanceProfiles}
            metricsByPlayer={response.metricsByPlayer}
            highlights={response.highlights}
          />
          <AssetRevenueHistograms players={response.players} histograms={response.histograms} />
          <div className="grid gap-2">
            <h3 className={contentText.heading}>資産タイプの位置</h3>
            <StrategyProfileQuadrant
              players={response.players}
              profile={response.performanceProfiles}
            />
          </div>
        </div>
      </AnalysisSection>
      <RevenueOutcomeSection focusedItemIds={focusedItemIds} response={response} />
      <DestinationOutcomeSection response={response} />
      <AnalysisSection id="metric-strategy-scatter" title="試合ごとの資産と収益">
        <div className="grid gap-4">
          <StrategyScatter
            focusedItemIds={focusedItemIds}
            players={response.players}
            points={response.strategyScatter.points}
          />
          <FactList
            ariaLabel="指標ごとの4人内最高"
            columns={4}
            items={response.highlights.map((highlight) => ({
              id: highlight.highlightId,
              label: highlightMetricLabel(highlight.metricId),
              value: (
                <span className="grid">
                  <span>{memberNames(response.players, highlight.leaderMemberIds)}</span>
                  <span className={contentText.compactPrimary}>
                    {formatHighlightValue(highlight.metricId, highlight.value)}
                  </span>
                </span>
              ),
            }))}
            layout="plain"
          />
        </div>
      </AnalysisSection>
      <ExpectedRankGapSection
        gap={response.expectedRankGap}
        players={response.players}
        memberId={expectedRankGapMemberId}
        onMemberChange={onExpectedRankGapMemberChange}
        onDrilldown={onDrilldown}
      />
    </div>
  );
});
