import type { SeriesAnalysisMatchContextV2 } from "@/shared/api/seriesAnalysis";
import { matchFeatureDefinition } from "@/shared/domain/matchFeatures";
import type { MatchFeatureDefinition } from "@/shared/domain/matchFeatures";
import { formatDateOnly, formatDateTimeLong } from "@/shared/lib/dateTime";
export { seriesComparisonHrefForMatch } from "@/shared/navigation/matchLinks";

export type MatchFeatureBadge = MatchFeatureDefinition & {
  tone: AnalysisFeature["tone"];
};
type AnalysisFeature = NonNullable<SeriesAnalysisMatchContextV2["match"]>["features"][number];

export function formatMatchDetailDate(iso: string): string {
  return formatDateTimeLong(iso);
}

export function formatMatchDetailDateOnly(iso: string): string {
  return formatDateOnly(iso);
}

export function buildMatchFeatureBadges({
  features = [],
}: {
  features?: AnalysisFeature[] | undefined;
}): MatchFeatureBadge[] {
  return features.map((feature) => ({
    ...matchFeatureDefinition(feature.featureCode),
    tone: feature.tone,
  }));
}
