import { memo } from "react";

import {
  CardShopDestinationQuadrants,
  PlayOrderMatrix,
} from "@/features/seriesComparison/charts/SeriesAnalysisContextCharts";
import { SeriesTrendCharts } from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import { SeriesAnalysisOwnerComparison } from "@/features/seriesComparison/charts/SeriesAnalysisOwnerComparison";
import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import {
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
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
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

export const ContextView = memo(function ContextView({
  focusedItemIds,
  focusedOwnerMemberId,
  response,
  onDrilldown,
  ownerMetric,
  onOwnerMetricChange,
}: AnalysisViewProps & {
  focusedOwnerMemberId?: string | undefined;
  ownerMetric: OwnerMetricId;
  onOwnerMetricChange: ((metric: OwnerMetricId) => void) | undefined;
}) {
  return (
    <div
      aria-labelledby={analysisTabId("context")}
      className="grid gap-8"
      id={analysisPanelId("context")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="context" />
      <AnalysisSection id="metric-play-order" title="番手比較">
        <div className="grid gap-2">
          <PlayOrderMatrix focusedItemIds={focusedItemIds} entries={response.playOrderComparison} />
          <div className="flex flex-wrap gap-2">
            {response.playOrderComparison.map((entry) => (
              <Button
                key={entry.memberId}
                size="sm"
                variant="quiet"
                onClick={() =>
                  onDrilldown({ memberId: entry.memberId, metricId: "playOrder.rankHistory" })
                }
              >
                <MemberSequenceLabel accent={false} memberId={entry.memberId}>
                  {entry.displayName}の番手別推移を見る
                </MemberSequenceLabel>
              </Button>
            ))}
          </div>
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-owner" title="オーナー比較">
        <SeriesAnalysisOwnerComparison
          comparison={response.ownerComparison}
          focusedOwnerMemberId={focusedOwnerMemberId}
          hasMatches={response.scope.matchCount > 0}
          metric={ownerMetric}
          onMetricChange={onOwnerMetricChange}
        />
      </AnalysisSection>
      <AnalysisSection id="metric-card-shop-destination" title="カード売り場と目的地">
        <CardShopDestinationQuadrants
          focusedItemIds={focusedItemIds}
          entries={response.cardShopDestination}
        />
      </AnalysisSection>
      <AnalysisSection id="metric-ginji" title="スリの銀次">
        <div className="grid gap-6">
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            {response.metricsByPlayer.map((metric) => (
              <article className="grid min-w-0 content-start gap-2" key={metric.memberId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className={contentText.heading}>
                    <MemberSequenceLabel memberId={metric.memberId}>
                      {metric.displayName}
                    </MemberSequenceLabel>
                  </h3>
                  <span className={cn(contentText.supporting, "tabular-nums")}>
                    遭遇 {metric.ginji.encounterMatches}戦
                  </span>
                </div>
                <FactList
                  ariaLabel={`${metric.displayName}のスリの銀次`}
                  items={[
                    {
                      id: "encounter-rate",
                      label: "遭遇率",
                      value: formatPercent(metric.ginji.encounterRate),
                    },
                    { id: "count", label: "合計回数", value: `${metric.ginji.count}回` },
                    {
                      id: "rank-average",
                      label: "遭遇時平均順位",
                      value: `${formatDecimal(metric.ginji.resilienceRankAverage)}位`,
                    },
                    {
                      id: "assets-average",
                      label: "遭遇時平均資産",
                      value: formatManYen(metric.ginji.resilienceAssetsAverage),
                    },
                    {
                      id: "multi-encounter",
                      label: "複数回遭遇した試合",
                      value: `${metric.ginji.multiEncounterMatchCount}戦`,
                    },
                    {
                      id: "max-in-match",
                      label: "1試合の最多遭遇",
                      value: `${metric.ginji.maxInSingleMatch}回`,
                    },
                    {
                      id: "revenue-average",
                      label: "遭遇時平均収益",
                      value: formatManYen(metric.ginji.resilienceRevenueAverage),
                    },
                  ]}
                  layout="inline"
                />
              </article>
            ))}
          </div>
          <AnalysisSubsection id="metric-ginji-cumulative" title="累計遭遇回数">
            <SeriesTrendCharts
              focusedItemIds={focusedItemIds}
              players={response.players}
              trends={response.trends}
              variant="ginji"
            />
          </AnalysisSubsection>
        </div>
      </AnalysisSection>
    </div>
  );
});
