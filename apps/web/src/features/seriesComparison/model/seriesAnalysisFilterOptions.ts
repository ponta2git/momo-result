import { findSeriesAnalysisTitle } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";

export function buildSeriesAnalysisFilterOptions(
  options: SeriesAnalysisOptionsResponse | undefined,
  state: SeriesAnalysisUrlState,
) {
  const selectedTitle = findSeriesAnalysisTitle(options, state.gameTitleId);
  return {
    confirmedMatchCount: selectedTitle?.confirmedMatchCount ?? 0,
    mapOptions: [
      { label: "全マップ", value: "" },
      ...(selectedTitle?.maps.map((map) => ({
        label: map.displayName,
        value: map.mapMasterId,
      })) ?? []),
    ],
    seasonOptions: [
      { label: "全シーズン", value: "" },
      ...(selectedTitle?.seasons.map((season) => ({
        label: season.displayName,
        value: season.seasonMasterId,
      })) ?? []),
    ],
    seriesOptions:
      options?.titles.map((title) => ({
        label: `${title.displayName} (${title.confirmedMatchCount}戦)`,
        summaryLabel: title.displayName,
        value: title.gameTitleId,
      })) ?? [],
  };
}
