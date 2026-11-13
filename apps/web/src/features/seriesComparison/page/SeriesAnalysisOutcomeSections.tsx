import { RevenueConversionMatrices } from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/model/seriesAnalysisViewTypes";
import { AnalysisSection } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { FactList } from "@/shared/ui/data/FactList";
import type { FactListItem } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

type Response = AnalysisViewProps["response"];
type Outcome = Response["metricsByPlayer"][number]["revenueOutcome"]["top"];

export function RevenueOutcomeSection({
  focusedItemIds,
  response,
}: Pick<AnalysisViewProps, "focusedItemIds" | "response">) {
  return (
    <AnalysisSection id="metric-revenue-outcome" title="物件収益と最終順位">
      <div className="grid gap-4">
        <RevenueConversionMatrices
          focusedItemIds={focusedItemIds}
          entries={response.revenueRankConversion}
        />
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
          {response.metricsByPlayer.map((metric) => (
            <article className="grid min-w-0 content-start gap-4" key={metric.memberId}>
              <div className="grid gap-2">
                <h3 className={contentText.heading}>
                  <MemberSequenceLabel memberId={metric.memberId}>
                    {metric.displayName}
                  </MemberSequenceLabel>
                </h3>
                <FactList
                  ariaLabel={`${metric.displayName}の物件収益と順位`}
                  items={[
                    {
                      id: "top-win-rate",
                      label: "収益上位時の勝率",
                      value: formatPercent(metric.revenueOutcome.top.winRate),
                    },
                    {
                      id: "top-podium-rate",
                      label: "収益上位時の入賞率",
                      value: formatPercent(metric.revenueOutcome.top.podiumRate),
                    },
                    {
                      id: "high-revenue-no-win",
                      label: "収益上位でも未勝利",
                      value: `${metric.nonRevenue.highRevenueNoWinCount}戦`,
                    },
                    {
                      id: "low-revenue-podium-rate",
                      label: "低収益時の入賞率",
                      value: formatPercent(metric.revenueOutcome.lowRevenue.podiumRate),
                    },
                  ]}
                  layout="inline"
                />
              </div>
              <Disclosure panelPadding="sm" summary="収益と順位の詳細">
                <FactList
                  ariaLabel={`${metric.displayName}の収益と順位の詳細`}
                  items={[
                    {
                      id: "rank-delta",
                      label: "収益順位だけでは説明しない順位差",
                      value: `${formatDecimal(metric.nonRevenue.rankDelta)}位`,
                    },
                    {
                      id: "high-revenue-no-win-rate",
                      label: "収益上位でも未勝利の割合",
                      value: formatPercent(metric.nonRevenue.highRevenueNoWinRate),
                    },
                    {
                      id: "non-top-win",
                      label: "収益1位以外からの勝利",
                      value: `${metric.revenueOutcome.nonTopWinCount}戦`,
                    },
                    outcomeDetailsFact("top", "収益上位時", metric.revenueOutcome.top),
                    outcomeDetailsFact("low", "低収益時", metric.revenueOutcome.lowRevenue),
                  ]}
                  layout="plain"
                />
              </Disclosure>
            </article>
          ))}
        </div>
      </div>
    </AnalysisSection>
  );
}

export function DestinationOutcomeSection({ response }: { response: Response }) {
  return (
    <AnalysisSection id="metric-destination-outcome" title="目的地到着と順位">
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
        {response.metricsByPlayer.map((metric) => (
          <article className="grid min-w-0 content-start gap-4" key={metric.memberId}>
            <div className="grid gap-2">
              <h3 className={contentText.heading}>
                <MemberSequenceLabel memberId={metric.memberId}>
                  {metric.displayName}
                </MemberSequenceLabel>
              </h3>
              <FactList
                ariaLabel={`${metric.displayName}の目的地到着と順位`}
                items={[
                  conditionalOutcomeFact(
                    "top",
                    "目的地到着が多い試合",
                    metric.destinationOutcome.top,
                  ),
                  conditionalOutcomeFact(
                    "low",
                    "目的地到着が少ない試合",
                    metric.destinationOutcome.lowDestination,
                  ),
                  conditionalOutcomeFact(
                    "zero",
                    "目的地到着0回",
                    metric.destinationOutcome.zeroDestination,
                  ),
                ]}
                layout="plain"
              />
            </div>
            <Disclosure panelPadding="sm" summary="目的地と順位の詳細">
              <FactList
                ariaLabel={`${metric.displayName}の目的地と順位の詳細`}
                items={[
                  {
                    id: "conversion-delta",
                    label: "到着多寡による入賞率差",
                    value: formatPercent(metric.destination.conversionDelta),
                  },
                  {
                    id: "dependence",
                    label: "目的地への依存度",
                    value: formatPercent(metric.destination.dependenceScore),
                  },
                  {
                    id: "upper-target",
                    label: "到着上位の対象",
                    value: `${metric.destination.upperTargetCount}戦`,
                  },
                  {
                    id: "lower-target",
                    label: "到着下位の対象",
                    value: `${metric.destination.lowerTargetCount}戦`,
                  },
                  outcomeDetailsFact("top", "到着上位", metric.destinationOutcome.top),
                  outcomeDetailsFact("low", "到着下位", metric.destinationOutcome.lowDestination),
                  outcomeDetailsFact("zero", "到着0回", metric.destinationOutcome.zeroDestination),
                ]}
                layout="plain"
              />
            </Disclosure>
          </article>
        ))}
      </div>
    </AnalysisSection>
  );
}

function outcomeDetailsFact(id: string, label: string, outcome: Outcome): FactListItem {
  const qualityAdvisory = qualityAdvisoryLabel(outcome.qualityStatus);
  return {
    id: `${id}-details`,
    label: `${label}の内訳`,
    value: (
      <span className="grid gap-1">
        <span>
          勝利 {outcome.winCount}戦・入賞 {outcome.podiumCount}戦・下位 {outcome.lowerHalfCount}戦（
          {formatPercent(outcome.lowerHalfRate)}）
        </span>
        <span>
          順位分布{" "}
          {outcome.rankDistribution.map((cell) => `${cell.rank}位 ${cell.count}戦`).join("・")}
        </span>
        {qualityAdvisory ? (
          <span>
            <SeriesAnalysisQualityAdvisory status={outcome.qualityStatus} />
          </span>
        ) : null}
      </span>
    ),
  };
}

function conditionalOutcomeFact(
  id: string,
  label: string,
  outcome: { podiumRate: number | null; targetCount: number; winRate: number | null },
): FactListItem {
  return {
    id,
    label,
    value: `${outcome.targetCount}戦・勝率 ${formatPercent(outcome.winRate)}・入賞率 ${formatPercent(outcome.podiumRate)}`,
  };
}
