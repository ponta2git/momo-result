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
      <AnalysisSection
        description={`現在の先頭は${memberNames(response.players, response.summary.leaderMemberIds)}。平均順位の最大差は${formatDecimal(response.summary.averageRankSpread)}です。`}
        id="metric-basic"
        title="順位と基礎比較"
      >
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
      <AnalysisSection
        description="登録済み試合を反復抽出したとき、各プレーヤーが平均順位首位になる割合です。僅差なら首位は固定と見ません。"
        id="metric-crown-certainty"
        title="王座の確からしさ"
      >
        <CrownShareBars response={response} />
        <p className="mt-3 text-xs text-[var(--color-text-secondary)] tabular-nums">
          有効反復 {response.rankAnalysis.crownCertainty.successfulIterations}/
          {response.rankAnalysis.crownCertainty.bootstrapIterations}回
        </p>
      </AnalysisSection>
      <AnalysisSection
        description="同じ試合で相手より上位だった割合です。色の濃さは分析結果が示す差の強さです。"
        id="metric-head-to-head"
        title="直接対決"
      >
        <HeadToHeadMatrix response={response} />
      </AnalysisSection>
      <AnalysisSection
        description="全試合を古い順に積み上げた平均順位と順位のぶれです。平均順位は1位が上になる向きで示します。"
        id="metric-rate"
        title="順位の安定性"
      >
        <RankTrendCharts focusedItemIds={focusedItemIds} response={response} />
      </AnalysisSection>
    </div>
  );
}
