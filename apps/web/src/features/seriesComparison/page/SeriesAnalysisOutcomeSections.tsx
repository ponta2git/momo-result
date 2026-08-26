import { RevenueConversionMatrices } from "@/features/seriesComparison/charts/SeriesAnalysisDriverCharts";
import {
  formatDecimal,
  formatPercent,
} from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import type { AnalysisViewProps } from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  AnalysisSection,
  MetricValue,
} from "@/features/seriesComparison/page/SeriesAnalysisViewPrimitives";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import { orderFixedMembers } from "@/shared/domain/members";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { MemberSequenceLabel } from "@/shared/ui/data/MemberSequenceLabel";

type Response = AnalysisViewProps["response"];
type Outcome = Response["metricsByPlayer"][number]["revenueOutcome"]["top"];

export function RevenueOutcomeSection({
  focusedItemIds,
  response,
}: Pick<AnalysisViewProps, "focusedItemIds" | "response">) {
  return (
    <AnalysisSection id="metric-revenue-outcome" title="物件収益と最終順位">
      <RevenueConversionMatrices focusedItemIds={focusedItemIds} response={response} />
      <div className="mt-4 grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
        {orderFixedMembers(response.metricsByPlayer).map((metric) => (
          <article className="min-w-0" key={metric.memberId}>
            <h3 className="font-semibold">
              <MemberSequenceLabel memberId={metric.memberId}>
                {metric.displayName}
              </MemberSequenceLabel>
            </h3>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <MetricValue
                label="収益上位時の勝率"
                value={formatPercent(metric.revenueOutcome.top.winRate)}
              />
              <MetricValue
                label="収益上位時の入賞率"
                value={formatPercent(metric.revenueOutcome.top.podiumRate)}
              />
              <MetricValue
                label="収益上位でも未勝利"
                value={`${metric.nonRevenue.highRevenueNoWinCount}戦`}
              />
              <MetricValue
                label="低収益時の入賞率"
                value={formatPercent(metric.revenueOutcome.lowRevenue.podiumRate)}
              />
            </dl>
            <Disclosure
              className="mt-3"
              panelClassName="p-3"
              presentation="inset"
              summary="収益と順位の詳細"
            >
              <dl className="grid gap-2 text-xs">
                <MetricValue
                  label="収益順位だけでは説明しない順位差"
                  value={`${formatDecimal(metric.nonRevenue.rankDelta)}位`}
                />
                <MetricValue
                  label="収益上位でも未勝利の割合"
                  value={formatPercent(metric.nonRevenue.highRevenueNoWinRate)}
                />
                <MetricValue
                  label="収益1位以外からの勝利"
                  value={`${metric.revenueOutcome.nonTopWinCount}戦`}
                />
                <OutcomeDetails label="収益上位時" outcome={metric.revenueOutcome.top} />
                <OutcomeDetails label="低収益時" outcome={metric.revenueOutcome.lowRevenue} />
              </dl>
            </Disclosure>
          </article>
        ))}
      </div>
    </AnalysisSection>
  );
}

export function DestinationOutcomeSection({ response }: { response: Response }) {
  return (
    <AnalysisSection id="metric-destination-outcome" title="目的地到着と順位">
      <div className="grid gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
        {orderFixedMembers(response.metricsByPlayer).map((metric) => (
          <article className="min-w-0" key={metric.memberId}>
            <h3 className="font-semibold">
              <MemberSequenceLabel memberId={metric.memberId}>
                {metric.displayName}
              </MemberSequenceLabel>
            </h3>
            <dl className="mt-3 grid gap-3 text-sm">
              <ConditionalOutcome
                label="目的地到着が多い試合"
                podiumRate={metric.destinationOutcome.top.podiumRate}
                targetCount={metric.destinationOutcome.top.targetCount}
                winRate={metric.destinationOutcome.top.winRate}
              />
              <ConditionalOutcome
                label="目的地到着が少ない試合"
                podiumRate={metric.destinationOutcome.lowDestination.podiumRate}
                targetCount={metric.destinationOutcome.lowDestination.targetCount}
                winRate={metric.destinationOutcome.lowDestination.winRate}
              />
              <ConditionalOutcome
                label="目的地到着0回"
                podiumRate={metric.destinationOutcome.zeroDestination.podiumRate}
                targetCount={metric.destinationOutcome.zeroDestination.targetCount}
                winRate={metric.destinationOutcome.zeroDestination.winRate}
              />
            </dl>
            <Disclosure
              className="mt-3"
              panelClassName="p-3"
              presentation="inset"
              summary="目的地と順位の詳細"
            >
              <dl className="grid gap-2 text-xs">
                <MetricValue
                  label="到着多寡による入賞率差"
                  value={formatPercent(metric.destination.conversionDelta)}
                />
                <MetricValue
                  label="目的地への依存度"
                  value={formatPercent(metric.destination.dependenceScore)}
                />
                <MetricValue
                  label="到着上位の対象"
                  value={`${metric.destination.upperTargetCount}戦`}
                />
                <MetricValue
                  label="到着下位の対象"
                  value={`${metric.destination.lowerTargetCount}戦`}
                />
                <OutcomeDetails label="到着上位" outcome={metric.destinationOutcome.top} />
                <OutcomeDetails
                  label="到着下位"
                  outcome={metric.destinationOutcome.lowDestination}
                />
                <OutcomeDetails
                  label="到着0回"
                  outcome={metric.destinationOutcome.zeroDestination}
                />
              </dl>
            </Disclosure>
          </article>
        ))}
      </div>
    </AnalysisSection>
  );
}

function OutcomeDetails({ label, outcome }: { label: string; outcome: Outcome }) {
  const qualityAdvisory = qualityAdvisoryLabel(outcome.qualityStatus);
  return (
    <div className="border-l-2 border-[var(--color-border)] px-2 py-1">
      <dt className="font-semibold">{label}の内訳</dt>
      <dd className="mt-1 text-[var(--color-text-secondary)] tabular-nums">
        勝利 {outcome.winCount}戦・入賞 {outcome.podiumCount}戦・下位 {outcome.lowerHalfCount}戦（
        {formatPercent(outcome.lowerHalfRate)}）
      </dd>
      <dd className="mt-1 text-[var(--color-text-secondary)] tabular-nums">
        順位分布{" "}
        {outcome.rankDistribution.map((cell) => `${cell.rank}位 ${cell.count}戦`).join("・")}
      </dd>
      {qualityAdvisory ? (
        <dd className="mt-1">
          <SeriesAnalysisQualityAdvisory status={outcome.qualityStatus} />
        </dd>
      ) : null}
    </div>
  );
}

function ConditionalOutcome({
  label,
  podiumRate,
  targetCount,
  winRate,
}: {
  label: string;
  podiumRate: number | null;
  targetCount: number;
  winRate: number | null;
}) {
  return (
    <div className="border-l-2 border-[var(--color-border)] px-2 py-1">
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="mt-1 text-xs text-[var(--color-text-secondary)] tabular-nums">
        {targetCount}戦・勝率 {formatPercent(winRate)}・入賞率 {formatPercent(podiumRate)}
      </dd>
    </div>
  );
}
