import { RankTrendCharts } from "@/features/seriesComparison/charts/SeriesAnalysisFlowCharts";
import {
  AnalysisTableCell,
  AnalysisTableHead,
} from "@/features/seriesComparison/charts/SeriesAnalysisMatrix";
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
  AnalysisReadingGuide,
  AnalysisSection,
  memberNames,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  analysisPanelId,
  analysisTabId,
  AnalysisTableOfContents,
} from "@/features/seriesComparison/page/SeriesComparisonAnalysisNavigation";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { Button } from "@/shared/ui/actions/Button";

export function OverviewView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  const crownQualityAdvisory = qualityAdvisoryLabel(response.rankAnalysis.crownCertainty.status);
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
              id: "leader",
              label: "平均順位の先頭",
              value: memberNames(response.players, response.summary.leaderMemberIds),
            },
            {
              id: "spread",
              label: "先頭と最後尾の平均順位差",
              value: `${formatDecimal(response.summary.averageRankSpread)}位`,
            },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead>
              <tr>
                <AnalysisTableHead>プレーヤー</AnalysisTableHead>
                <AnalysisTableHead>平均順位</AnalysisTableHead>
                <AnalysisTableHead>順位のぶれ</AnalysisTableHead>
                <AnalysisTableHead>入賞率</AnalysisTableHead>
                <AnalysisTableHead>下位率</AnalysisTableHead>
                <AnalysisTableHead>平均総資産</AnalysisTableHead>
                <AnalysisTableHead>平均物件収益</AnalysisTableHead>
                <AnalysisTableHead>推移</AnalysisTableHead>
              </tr>
            </thead>
            <tbody>
              {response.metricsByPlayer.map((metric) => (
                <tr className="border-t border-[var(--color-border)]" key={metric.memberId}>
                  <AnalysisTableCell>
                    <strong>{metric.displayName}</strong>
                  </AnalysisTableCell>
                  <AnalysisTableCell>{formatDecimal(metric.rank.average)}位</AnalysisTableCell>
                  <AnalysisTableCell>
                    {formatDecimal(metric.rank.standardDeviation)}
                  </AnalysisTableCell>
                  <AnalysisTableCell>{formatPercent(metric.podium.rate)}</AnalysisTableCell>
                  <AnalysisTableCell>{formatPercent(metric.lowerHalf.rate)}</AnalysisTableCell>
                  <AnalysisTableCell>{formatManYen(metric.assets.average)}</AnalysisTableCell>
                  <AnalysisTableCell>{formatManYen(metric.revenue.average)}</AnalysisTableCell>
                  <AnalysisTableCell>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        onDrilldown({ memberId: metric.memberId, metricId: "rank.averageHistory" })
                      }
                    >
                      詳細
                    </Button>
                  </AnalysisTableCell>
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
        <AnalysisFacts
          ariaLabel="平均順位首位の確からしさの判断材料"
          items={[
            {
              id: "comparison",
              label: "比較する場所",
              value: "先頭と次点の比率差",
            },
            {
              id: "scope",
              label: "根拠の範囲",
              value: `${response.rankAnalysis.matchCount}戦・${response.rankAnalysis.heldEventCount}開催`,
            },
            ...(crownQualityAdvisory
              ? [
                  {
                    id: "quality",
                    label:
                      response.rankAnalysis.crownCertainty.status === "reference" ? "注意" : "状態",
                    value: (
                      <SeriesAnalysisQualityAdvisory
                        status={response.rankAnalysis.crownCertainty.status}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
        <CrownShareBars response={response} />
        <div className="mt-4">
          <AnalysisReadingGuide
            ariaLabel="平均順位首位の確からしさの読み方"
            items={[
              {
                id: "meaning",
                label: "示すもの",
                value: "開催の組み合わせを変えても、期間内の平均順位首位に残った割合",
              },
              {
                id: "decision",
                label: "判断",
                value: "先頭と次点の差が広いほど、現在の首位は開催条件の偏りに左右されにくい",
              },
              {
                id: "next",
                label: "次に見る",
                value: "差が小さいときは「直接対決」と「順位の安定性」で並びを確かめる",
              },
              {
                id: "not-for",
                label: "使わない場面",
                value: "次戦の勝率や最終順位の予測には使わない",
              },
              {
                id: "validation",
                label: "検証条件",
                value: `再標本化 ${response.rankAnalysis.crownCertainty.successfulIterations}/${response.rankAnalysis.crownCertainty.bootstrapIterations}回成立・首位交代 ${response.rankAnalysis.crownCertainty.leaderChangeCount}回`,
              },
            ]}
          />
        </div>
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
