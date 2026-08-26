import {
  CardShopDestinationQuadrants,
  PlayOrderMatrix,
} from "@/features/seriesComparison/charts/SeriesAnalysisContextCharts";
import { GinjiCumulativeChart } from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import {
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  AnalysisSubsection,
  MetricValue,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

export function ContextView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("context")}
      className="grid gap-8"
      id={analysisPanelId("context")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="context" />
      <AnalysisSection id="metric-play-order" title="番手比較">
        <PlayOrderMatrix focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-3 flex flex-wrap gap-2">
          {orderFixedMembers(response.playOrderComparison).map((entry) => (
            <Button
              key={entry.memberId}
              size="sm"
              variant="quiet"
              onClick={() =>
                onDrilldown({ memberId: entry.memberId, metricId: "playOrder.rankHistory" })
              }
            >
              <MemberSequenceLabel accent={false} memberId={entry.memberId}>
                {entry.displayName}の番手別推移
              </MemberSequenceLabel>
            </Button>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-card-shop-destination" title="カード売り場と目的地">
        <CardShopDestinationQuadrants focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
      <AnalysisSection id="metric-ginji" title="スリの銀次">
        <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
          {orderFixedMembers(response.metricsByPlayer).map((metric) => (
            <article className="min-w-0" key={metric.memberId}>
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">
                  <MemberSequenceLabel memberId={metric.memberId}>
                    {metric.displayName}
                  </MemberSequenceLabel>
                </h3>
                <span className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                  遭遇 {metric.ginji.encounterMatches}戦
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <MetricValue label="遭遇率" value={formatPercent(metric.ginji.encounterRate)} />
                <MetricValue label="合計回数" value={`${metric.ginji.count}回`} />
                <MetricValue
                  label="遭遇時平均順位"
                  value={`${formatDecimal(metric.ginji.resilienceRankAverage)}位`}
                />
                <MetricValue
                  label="遭遇時平均資産"
                  value={formatManYen(metric.ginji.resilienceAssetsAverage)}
                />
                <MetricValue
                  label="複数回遭遇した試合"
                  value={`${metric.ginji.multiEncounterMatchCount}戦`}
                />
                <MetricValue label="1試合の最多遭遇" value={`${metric.ginji.maxInSingleMatch}回`} />
                <MetricValue
                  label="遭遇時平均収益"
                  value={formatManYen(metric.ginji.resilienceRevenueAverage)}
                />
              </dl>
            </article>
          ))}
        </div>
        <div className="mt-8">
          <AnalysisSubsection id="metric-ginji-cumulative" title="累計遭遇回数">
            <GinjiCumulativeChart focusedItemIds={focusedItemIds} response={response} />
          </AnalysisSubsection>
        </div>
      </AnalysisSection>
    </div>
  );
}
