import { formatPercent } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesAnalysisMomentumRate } from "@/shared/api/seriesAnalysisMetricTypes";

export function MomentumRateSummary({
  label,
  rate,
}: {
  label: string;
  rate: SeriesAnalysisMomentumRate;
}) {
  const qualityAdvisory = qualityAdvisoryLabel(rate.qualityStatus);
  return (
    <div className="rounded-[var(--radius-xs)] bg-[var(--color-surface)] p-2">
      <dt className="font-semibold">{label}</dt>
      <dd className="mt-1 text-[var(--color-text-secondary)] tabular-nums">
        {rate.successCount}/{rate.targetCount}戦・{formatPercent(rate.rate)}
      </dd>
      <dd className="text-[var(--color-text-secondary)] tabular-nums">
        通常 {formatPercent(rate.baselineRate)}・差 {formatPercent(rate.deltaFromBaseline)}・
        {momentumSignalLabel(rate.signal)}
      </dd>
      {qualityAdvisory ? (
        <dd className="mt-1">
          <SeriesAnalysisQualityAdvisory status={rate.qualityStatus} />
        </dd>
      ) : null}
    </div>
  );
}

function momentumSignalLabel(signal: SeriesAnalysisMomentumRate["signal"]): string {
  switch (signal) {
    case "strength":
      return "強み候補";
    case "risk":
      return "注意候補";
    case "none":
      return "目立つ差なし";
  }
}
