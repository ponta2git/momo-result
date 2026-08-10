import { RankTrendCharts } from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import {
  CrownShareBars,
  HeadToHeadMatrix,
  RankDistributionBars,
} from "@/features/seriesComparison/charts/SeriesAnalysisOverviewCharts";
import {
  formatDecimal,
  formatManYen,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisFacts,
  AnalysisSection,
  memberNames,
  TableCell,
  TableHead,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import { Button } from "@/shared/ui/actions/Button";

export function OverviewView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  return (
    <div
      aria-labelledby={analysisTabId("overview")}
      className="grid gap-4"
      id={analysisPanelId("overview")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="overview" />
      <AnalysisSection id="metric-basic" title="順位と基礎比較">
        <AnalysisFacts
          ariaLabel="現在の順位差"
          items={[
            {
              label: "平均順位の先頭",
              value: memberNames(response.players, response.summary.leaderMemberIds),
            },
            {
              label: "先頭と最後尾の平均順位差",
              value: `${formatDecimal(response.summary.averageRankSpread)}位`,
            },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr>
                <TableHead>プレーヤー</TableHead>
                <TableHead>平均順位</TableHead>
                <TableHead>順位のぶれ</TableHead>
                <TableHead>入賞率</TableHead>
                <TableHead>下位率</TableHead>
                <TableHead>平均総資産</TableHead>
                <TableHead>平均物件収益</TableHead>
                <TableHead>推移</TableHead>
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
                      詳細
                    </Button>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <RankDistributionBars focusedItemIds={focusedItemIds} response={response} />
        </div>
      </AnalysisSection>
      <AnalysisSection id="metric-crown-certainty" title="平均順位首位の確からしさ">
        <CrownShareBars response={response} />
      </AnalysisSection>
      <AnalysisSection id="metric-head-to-head" title="直接対決">
        <HeadToHeadMatrix response={response} />
      </AnalysisSection>
      <AnalysisSection id="metric-rate" title="順位の安定性">
        <RankTrendCharts focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
    </div>
  );
}
