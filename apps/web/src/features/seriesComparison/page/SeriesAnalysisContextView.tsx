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
  MetricValue,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function ContextView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("context")}
      className="grid gap-4"
      id={analysisPanelId("context")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="context" />
      <AnalysisSection
        description="手番ごとの平均順位と入賞率です。色は各人の中で最も良い手番との差を示し、手番そのものの有利不利を断定しません。"
        id="metric-play-order"
        title="番手比較"
      >
        <PlayOrderMatrix focusedItemIds={focusedItemIds} response={response} />
        <div className="mt-3 flex flex-wrap gap-2">
          {response.playOrderComparison.map((entry) => (
            <Button
              key={entry.memberId}
              size="sm"
              variant="quiet"
              onClick={() =>
                onDrilldown({ memberId: entry.memberId, metricId: "playOrder.rankHistory" })
              }
            >
              {entry.displayName}の番手別推移
            </Button>
          ))}
        </div>
      </AnalysisSection>
      <AnalysisSection
        description="目的地到着とカード売り場立ち寄りの組み合わせごとに、順位・勝率・資産を比べます。対象件数が少ない枠は参考値です。"
        id="metric-card-shop-destination"
        title="カード売り場と目的地"
      >
        <CardShopDestinationQuadrants focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
      <AnalysisSection
        description="スリの銀次に遭遇した試合数と、その試合で残した順位・資産です。遭遇率の高さを強さとは扱いません。"
        id="metric-ginji"
        title="スリの銀次"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {response.metricsByPlayer.map((metric) => (
            <article
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
              key={metric.memberId}
            >
              <div className="flex justify-between gap-2">
                <h3 className="font-semibold">{metric.displayName}</h3>
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
              </dl>
            </article>
          ))}
        </div>
        <div className="mt-5">
          <GinjiCumulativeChart focusedItemIds={focusedItemIds} response={response} />
        </div>
      </AnalysisSection>
    </div>
  );
}
