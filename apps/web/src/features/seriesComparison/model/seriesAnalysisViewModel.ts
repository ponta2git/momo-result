import type {
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";

export type SeriesAnalysisViewId = "context" | "drivers" | "flow" | "overview" | "review";

export type SeriesAnalysisUrlState = {
  focusMatchId?: string | undefined;
  gameTitleId?: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  view?: SeriesAnalysisViewId | undefined;
};

const legacyScopeKinds = new Set(["overall", "season", "map"]);
const viewIds = new Set(["review", "overview", "flow", "drivers", "context"]);

export const defaultSeriesAnalysisView: SeriesAnalysisViewId = "review";

export function isSeriesAnalysisViewId(
  value: string | null | undefined,
): value is SeriesAnalysisViewId {
  return viewIds.has(value ?? "");
}

function normalizeView(value: string | undefined): SeriesAnalysisViewId {
  return isSeriesAnalysisViewId(value) ? value : defaultSeriesAnalysisView;
}

export function parseSeriesAnalysisSearchParams(params: URLSearchParams): SeriesAnalysisUrlState {
  const gameTitleId = params.get("gameTitleId")?.trim() || undefined;
  const seasonMasterId = params.get("seasonMasterId")?.trim() || undefined;
  const mapMasterId = params.get("mapMasterId")?.trim() || undefined;
  const focusMatchId = params.get("focusMatchId")?.trim() || undefined;
  const view = normalizeView(params.get("view")?.trim());
  if (seasonMasterId || mapMasterId) {
    return { focusMatchId, gameTitleId, mapMasterId, seasonMasterId, view };
  }

  const rawKind = params.get("scopeKind")?.trim();
  const scopeKind = legacyScopeKinds.has(rawKind ?? "") ? rawKind : "overall";
  const scopeId = params.get("scopeId")?.trim() || undefined;
  return {
    focusMatchId,
    gameTitleId,
    mapMasterId: scopeKind === "map" ? scopeId : undefined,
    seasonMasterId: scopeKind === "season" ? scopeId : undefined,
    view,
  };
}

export function buildSeriesAnalysisSearchParams(state: SeriesAnalysisUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.gameTitleId) params.set("gameTitleId", state.gameTitleId);
  if (state.seasonMasterId) params.set("seasonMasterId", state.seasonMasterId);
  if (state.mapMasterId) params.set("mapMasterId", state.mapMasterId);
  if (state.focusMatchId) params.set("focusMatchId", state.focusMatchId);
  const view = normalizeView(state.view);
  if (view !== defaultSeriesAnalysisView) params.set("view", view);
  return params;
}

export function findSeriesAnalysisTitle(
  options: SeriesAnalysisOptionsResponse | undefined,
  gameTitleId: string | undefined,
) {
  return options?.titles.find((title) => title.gameTitleId === gameTitleId);
}

export function normalizeSeriesAnalysisSelection(
  options: SeriesAnalysisOptionsResponse | undefined,
  state: SeriesAnalysisUrlState,
): SeriesAnalysisUrlState {
  const titles = options?.titles ?? [];
  const selectedTitle =
    titles.find((title) => title.gameTitleId === state.gameTitleId) ??
    titles.find((title) => title.gameTitleId === options?.defaultGameTitleId) ??
    titles[0];
  const view = normalizeView(state.view);
  if (!selectedTitle) return { view };

  const seasonMasterId = selectedTitle.seasons.some(
    (season) => season.seasonMasterId === state.seasonMasterId,
  )
    ? state.seasonMasterId
    : undefined;
  let mapMasterId = selectedTitle.maps.some((map) => map.mapMasterId === state.mapMasterId)
    ? state.mapMasterId
    : undefined;
  if (
    seasonMasterId &&
    mapMasterId &&
    !selectedTitle.seasonMapPairs.some(
      (pair) => pair.seasonMasterId === seasonMasterId && pair.mapMasterId === mapMasterId,
    )
  ) {
    mapMasterId = undefined;
  }
  return {
    ...(state.focusMatchId ? { focusMatchId: state.focusMatchId } : {}),
    gameTitleId: selectedTitle.gameTitleId,
    ...(mapMasterId ? { mapMasterId } : {}),
    ...(seasonMasterId ? { seasonMasterId } : {}),
    view,
  };
}

export function seriesAnalysisQueryFromState(
  state: SeriesAnalysisUrlState,
  artifactId: string | undefined,
): SeriesAnalysisQuery | undefined {
  if (!state.gameTitleId || !artifactId) return undefined;
  return {
    artifactId,
    gameTitleId: state.gameTitleId,
    mapMasterId: state.mapMasterId,
    seasonMasterId: state.seasonMasterId,
  };
}

export function compatibleMapIds(
  options: SeriesAnalysisOptionsResponse | undefined,
  gameTitleId: string | undefined,
  seasonMasterId: string | undefined,
): Set<string> | undefined {
  if (!seasonMasterId) return undefined;
  const title = findSeriesAnalysisTitle(options, gameTitleId);
  return new Set(
    title?.seasonMapPairs
      .filter((pair) => pair.seasonMasterId === seasonMasterId)
      .map((pair) => pair.mapMasterId) ?? [],
  );
}

export function compatibleSeasonIds(
  options: SeriesAnalysisOptionsResponse | undefined,
  gameTitleId: string | undefined,
  mapMasterId: string | undefined,
): Set<string> | undefined {
  if (!mapMasterId) return undefined;
  const title = findSeriesAnalysisTitle(options, gameTitleId);
  return new Set(
    title?.seasonMapPairs
      .filter((pair) => pair.mapMasterId === mapMasterId)
      .map((pair) => pair.seasonMasterId) ?? [],
  );
}
