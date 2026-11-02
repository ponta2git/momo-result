import { formatPercent } from "@/features/seriesComparison/model/seriesAnalysisPresentation";
import {
  qualityAdvisoryLabel,
  SeriesAnalysisQualityAdvisory,
} from "@/features/seriesComparison/SeriesAnalysisQualityAdvisory";
import type { SeriesAnalysisMomentumRate } from "@/shared/api/seriesAnalysisMetricTypes";
import type { FactListItem } from "@/shared/ui/data/FactList";
import { contentText } from "@/shared/ui/typography";

/** One momentum rate as a label/value fact: the rate leads, the baseline and signal follow. */
export function momentumRateFact(
  id: string,
  label: string,
  rate: SeriesAnalysisMomentumRate,
): FactListItem {
  const qualityAdvisory = qualityAdvisoryLabel(rate.qualityStatus);
  return {
    id,
    label,
    value: (
      <span className="grid gap-1">
        <span className={contentText.compactPrimary}>
          {rate.successCount}/{rate.targetCount}戦・{formatPercent(rate.rate)}
        </span>
        <span>
          通常 {formatPercent(rate.baselineRate)}・差 {formatPercent(rate.deltaFromBaseline)}・
          {momentumSignalLabel(rate.signal)}
        </span>
        {qualityAdvisory ? (
          <span>
            <SeriesAnalysisQualityAdvisory status={rate.qualityStatus} />
          </span>
        ) : null}
      </span>
    ),
  };
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
