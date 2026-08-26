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
  AnalysisReadingGuide,
  AnalysisSection,
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
import { orderFixedMembers } from "@/shared/domain/members";
import { Button } from "@/shared/ui/actions/Button";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

export function OverviewView({ focusedItemIds, response, onDrilldown }: AnalysisViewProps) {
  const crownQualityAdvisory = qualityAdvisoryLabel(response.rankAnalysis.crownCertainty.status);
  const leaders = orderFixedMembers(
    response.players.filter((player) => response.summary.leaderMemberIds.includes(player.memberId)),
  );
  return (
    <div
      aria-labelledby={analysisTabId("overview")}
      className="grid gap-4"
      id={analysisPanelId("overview")}
      role="tabpanel"
    >
      <AnalysisTableOfContents view="overview" />
      <AnalysisSection id="metric-basic" title="順位と基礎比較">
        <dl
          aria-label="現在の順位差"
          className="mb-5 grid gap-4 border-b border-[var(--color-border)] pb-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        >
          <div>
            <dt className="text-xs font-semibold text-[var(--color-text-secondary)]">
              平均順位の先頭
            </dt>
            <dd className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-2xl font-semibold tracking-tight">
              {leaders.length > 0
                ? leaders.map((player) => (
                    <MemberSequenceLabel key={player.memberId} memberId={player.memberId}>
                      {player.displayName}
                    </MemberSequenceLabel>
                  ))
                : "—"}
            </dd>
          </div>
          <div className="sm:text-right">
            <dt className="text-xs text-[var(--color-text-secondary)]">先頭と最後尾の差</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {formatDecimal(response.summary.averageRankSpread)}位
            </dd>
          </div>
        </dl>
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
              {orderFixedMembers(response.metricsByPlayer).map((metric) => (
                <tr className="border-t border-[var(--color-border)]" key={metric.memberId}>
                  <AnalysisTableCell>
                    <strong>
                      <MemberSequenceLabel memberId={metric.memberId}>
                        {metric.displayName}
                      </MemberSequenceLabel>
                    </strong>
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
        <CrownShareBars response={response} />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
          <span>
            根拠 {response.rankAnalysis.matchCount}戦・{response.rankAnalysis.heldEventCount}開催
          </span>
          {crownQualityAdvisory ? (
            <SeriesAnalysisQualityAdvisory status={response.rankAnalysis.crownCertainty.status} />
          ) : null}
        </div>
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
