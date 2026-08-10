import {
  compatibleMapIds,
  compatibleSeasonIds,
  findSeriesAnalysisTitle,
  seriesAnalysisScopeName,
} from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";

export function buildSeriesAnalysisFilterOptions(
  options: SeriesAnalysisOptionsResponse | undefined,
  state: SeriesAnalysisUrlState,
) {
  const selectedTitle = findSeriesAnalysisTitle(options, state.gameTitleId);
  const mapIds = compatibleMapIds(options, state.gameTitleId, state.seasonMasterId);
  const seasonIds = compatibleSeasonIds(options, state.gameTitleId, state.mapMasterId);
  return {
    confirmedMatchCount: selectedTitle?.confirmedMatchCount ?? 0,
    mapOptions: [
      { label: "全マップ", value: "" },
      ...(selectedTitle?.maps.map((map) => ({
        disabled: mapIds ? !mapIds.has(map.mapMasterId) : false,
        label: map.displayName,
        value: map.mapMasterId,
      })) ?? []),
    ],
    scopeLabel: [selectedTitle?.displayName, seriesAnalysisScopeName(options, state)]
      .filter(Boolean)
      .join("・"),
    seasonOptions: [
      { label: "全シーズン", value: "" },
      ...(selectedTitle?.seasons.map((season) => ({
        disabled: seasonIds ? !seasonIds.has(season.seasonMasterId) : false,
        label: season.displayName,
        value: season.seasonMasterId,
      })) ?? []),
    ],
    seriesOptions:
      options?.titles.map((title) => ({
        label: `${title.displayName} (${title.confirmedMatchCount}戦)`,
        value: title.gameTitleId,
      })) ?? [],
  };
}
