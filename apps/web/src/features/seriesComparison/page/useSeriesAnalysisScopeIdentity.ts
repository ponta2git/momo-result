import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import type { SeriesAnalysisOptionsResponse } from "@/shared/api/seriesAnalysis";
import { seriesAnalysisScopeStatusQueryOptions } from "@/shared/api/seriesPlayerRadar";

/** Retains a selected master after its last match disappears, and validates URL-only identities. */
export function useSeriesAnalysisScopeIdentity(options: SeriesAnalysisOptionsResponse | undefined) {
  const [params] = useSearchParams();
  const requestedTitleId = params.get("gameTitleId")?.trim() || options?.defaultGameTitleId;
  const title = options?.titles.find((entry) => entry.gameTitleId === requestedTitleId);
  const seasonMasterId = params.get("seasonMasterId")?.trim() || undefined;
  const mapMasterId = params.get("mapMasterId")?.trim() || undefined;
  const query = useQuery(
    seriesAnalysisScopeStatusQueryOptions(
      title && (seasonMasterId || mapMasterId)
        ? { gameTitleId: title.gameTitleId, seasonMasterId, mapMasterId }
        : undefined,
    ),
  );
  const identity = query.data;
  const unknownSeason =
    seasonMasterId && !title?.seasons.some((entry) => entry.seasonMasterId === seasonMasterId);
  const unknownMap = mapMasterId && !title?.maps.some((entry) => entry.mapMasterId === mapMasterId);
  const pendingIdentity = Boolean(title && !identity && (unknownSeason || unknownMap));
  if (!title || !options) return { options, pending: false, query };

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
        identity?.seasonName ?? (query.isError ? "シーズン名を確認できません" : "シーズンを確認中"),
    });
  }
  if (mapMasterId && unknownMap && !identity?.invalidFields.includes("mapMasterId")) {
    maps.push({
      mapMasterId,
      displayName:
        identity?.mapName ?? (query.isError ? "マップ名を確認できません" : "マップを確認中"),
    });
  }
  return {
    options: {
      ...options,
      titles: options.titles.map((entry) =>
        entry.gameTitleId === title.gameTitleId ? { ...entry, seasons, maps } : entry,
      ),
    },
    pending: pendingIdentity,
    query,
  };
}
