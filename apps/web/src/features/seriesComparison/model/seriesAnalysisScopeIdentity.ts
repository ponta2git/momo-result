import type { SeriesAnalysisSelection } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";
import type {
  SeriesAnalysisScopeStatus,
  SeriesAnalysisScopeStatusQuery,
} from "@/shared/api/seriesPlayerRadar";

type ScopeIdentityResolution =
  | { kind: "pending"; reason: "options"; options: undefined }
  | {
      kind: "pending";
      reason: "identity";
      options: SeriesAnalysisOptionsResponse;
    }
  | { kind: "ready"; options: SeriesAnalysisOptionsResponse };

function requestedTitle(
  options: SeriesAnalysisOptionsResponse | undefined,
  requested: SeriesAnalysisSelection,
) {
  const gameTitleId = requested.gameTitleId ?? options?.defaultGameTitleId;
  return options?.titles.find((title) => title.gameTitleId === gameTitleId);
}

export function seriesAnalysisScopeIdentityQuery(
  options: SeriesAnalysisOptionsResponse | undefined,
  requested: SeriesAnalysisSelection,
): SeriesAnalysisScopeStatusQuery | undefined {
  const title = requestedTitle(options, requested);
  return title && (requested.seasonMasterId || requested.mapMasterId)
    ? {
        gameTitleId: title.gameTitleId,
        seasonMasterId: requested.seasonMasterId,
        mapMasterId: requested.mapMasterId,
      }
    : undefined;
}

/** A master missing from the match directory remains selected until its identity is verified. */
export function resolveSeriesAnalysisScopeIdentity({
  options,
  requested,
  identity,
  identityFailed,
}: {
  options: SeriesAnalysisOptionsResponse | undefined;
  requested: SeriesAnalysisSelection;
  identity: SeriesAnalysisScopeStatus | undefined;
  identityFailed: boolean;
}): ScopeIdentityResolution {
  if (!options) return { kind: "pending", reason: "options", options };
  const title = requestedTitle(options, requested);
  if (!title) return { kind: "ready", options };
  const { seasonMasterId, mapMasterId } = requested;
  const unknownSeason =
    seasonMasterId && !title.seasons.some((entry) => entry.seasonMasterId === seasonMasterId);
  const unknownMap = mapMasterId && !title.maps.some((entry) => entry.mapMasterId === mapMasterId);
  const seasons = title.seasons.filter(
    (entry) =>
      !(
        entry.seasonMasterId === seasonMasterId &&
        identity?.invalidFields.includes("seasonMasterId")
      ),
  );
  const maps = title.maps.filter(
    (entry) =>
      !(entry.mapMasterId === mapMasterId && identity?.invalidFields.includes("mapMasterId")),
  );
  if (seasonMasterId && unknownSeason && !identity?.invalidFields.includes("seasonMasterId")) {
    seasons.push({
      seasonMasterId,
      displayName:
        identity?.seasonName ??
        (identityFailed ? "シーズン名を確認できません" : "シーズンを確認中"),
    });
  }
  if (mapMasterId && unknownMap && !identity?.invalidFields.includes("mapMasterId")) {
    maps.push({
      mapMasterId,
      displayName:
        identity?.mapName ?? (identityFailed ? "マップ名を確認できません" : "マップを確認中"),
    });
  }
  const resolvedOptions = {
    ...options,
    titles: options.titles.map((entry) =>
      entry.gameTitleId === title.gameTitleId ? { ...entry, seasons, maps } : entry,
    ),
  };
  return !identity && (unknownSeason || unknownMap)
    ? { kind: "pending", reason: "identity", options: resolvedOptions }
    : { kind: "ready", options: resolvedOptions };
}
