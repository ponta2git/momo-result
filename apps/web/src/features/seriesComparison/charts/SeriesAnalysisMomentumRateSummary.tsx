import { formatPercent } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesAnalysisMomentumRate } from "@/shared/api/seriesAnalysisMetricTypes";
import { cn } from "@/shared/ui/cn";
import { contentText } from "@/shared/ui/typography";

export function MomentumRateSummary({
  label,
  rate,
}: {
  label: string;
  rate: SeriesAnalysisMomentumRate;
}) {
  const qualityAdvisory = qualityAdvisoryLabel(rate.qualityStatus);
  return (
    <div className="min-w-0">
      <dt className={contentText.supporting}>{label}</dt>
      <dd className={cn(contentText.compactPrimary, "mt-1 tabular-nums")}>
        {rate.successCount}/{rate.targetCount}戦・{formatPercent(rate.rate)}
      </dd>
      <dd className={cn(contentText.body, "mt-1 tabular-nums")}>
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
