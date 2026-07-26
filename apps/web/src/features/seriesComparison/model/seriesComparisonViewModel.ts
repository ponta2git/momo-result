import type {
  SeriesComparisonOptionsResponse,
  SeriesComparisonQuery,
  SeriesComparisonReviewQuery,
} from "@/shared/api/seriesComparison";

export type { PlayOrderSignal, ProfileKind } from "./seriesComparisonSummaries";
export {
  assetStyleKindLabel,
  assetStyleShapeLabel,
  assetStyleTagLabel,
  averageRankSpread,
  ginjiSummary,
  playOrderSignal,
  profileKindLabel,
  qualitySummary,
  statusLabel,
  strategyKindLabel,
  timelineFlagLabel,
} from "./seriesComparisonSummaries";

export type SeriesComparisonUrlState = {
  focusMatchId?: string | undefined;
  gameTitleId?: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  view?: SeriesComparisonViewId | undefined;
};

export type SeriesComparisonViewId = "context" | "drivers" | "flow" | "overview" | "review";

const legacyScopeKinds = new Set(["overall", "season", "map"]);
const viewIds = new Set(["review", "overview", "flow", "drivers", "context"]);
export const defaultSeriesComparisonView: SeriesComparisonViewId = "review";

export function isSeriesComparisonViewId(
  value: string | null | undefined,
): value is SeriesComparisonViewId {
  return viewIds.has(value ?? "");
}

function normalizeView(value: string | undefined): SeriesComparisonViewId {
  return isSeriesComparisonViewId(value) ? value : defaultSeriesComparisonView;
}

export function parseSeriesComparisonSearchParams(
  params: URLSearchParams,
): SeriesComparisonUrlState {
  const gameTitleId = params.get("gameTitleId")?.trim() || undefined;
  const seasonMasterId = params.get("seasonMasterId")?.trim() || undefined;
  const mapMasterId = params.get("mapMasterId")?.trim() || undefined;
  const focusMatchId = params.get("focusMatchId")?.trim() || undefined;
  const view = normalizeView(params.get("view")?.trim());
  if (seasonMasterId || mapMasterId) {
    return {
      focusMatchId,
      gameTitleId,
      mapMasterId,
      seasonMasterId,
      view,
    };
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

export function buildSeriesComparisonSearchParams(
  state: SeriesComparisonUrlState,
): URLSearchParams {
  const params = new URLSearchParams();
  const view = normalizeView(state.view);
  if (state.gameTitleId) {
    params.set("gameTitleId", state.gameTitleId);
  }
  if (state.seasonMasterId) {
    params.set("seasonMasterId", state.seasonMasterId);
  }
  if (state.mapMasterId) {
    params.set("mapMasterId", state.mapMasterId);
  }
  if (state.focusMatchId) {
    params.set("focusMatchId", state.focusMatchId);
  }
  if (view !== defaultSeriesComparisonView) {
    params.set("view", view);
  }
  return params;
}

export function normalizeSeriesComparisonSelection(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): SeriesComparisonUrlState {
  const series = options?.series ?? [];
  const view = normalizeView(state.view);
  const fallbackGameTitleId = options?.latestConfirmedGameTitleId ?? series[0]?.gameTitleId;
  const selectedSeries =
    series.find((item) => item.gameTitleId === state.gameTitleId) ??
    series.find((item) => item.gameTitleId === fallbackGameTitleId) ??
    series[0];

  if (!selectedSeries) {
    return {
      gameTitleId: undefined,
      mapMasterId: undefined,
      seasonMasterId: undefined,
      view,
    };
  }

  const selectedSeason = (selectedSeries.seasons ?? []).find(
    (item) => item.id === state.seasonMasterId,
  );
  const selectedMap = (selectedSeries.maps ?? []).find((item) => item.id === state.mapMasterId);
  return {
    ...(state.focusMatchId ? { focusMatchId: state.focusMatchId } : {}),
    gameTitleId: selectedSeries.gameTitleId,
    mapMasterId: selectedMap?.id,
    seasonMasterId: selectedSeason?.id,
    view,
  };
}

export function seriesComparisonQueryFromState(
  state: SeriesComparisonUrlState,
): SeriesComparisonQuery | undefined {
  if (!state.gameTitleId) {
    return undefined;
  }
  return {
    gameTitleId: state.gameTitleId,
    mapMasterId: state.mapMasterId,
    seasonMasterId: state.seasonMasterId,
  };
}

export function seriesComparisonReviewQueryFromState(
  state: SeriesComparisonUrlState,
): SeriesComparisonReviewQuery | undefined {
  const query = seriesComparisonQueryFromState(state);
  if (!query) {
    return undefined;
  }
  return {
    ...query,
  };
}

export function findSelectedSeries(
  options: SeriesComparisonOptionsResponse | undefined,
  gameTitleId: string | undefined,
) {
  return (options?.series ?? []).find((series) => series.gameTitleId === gameTitleId);
}

export function scopeNameForState(
  options: SeriesComparisonOptionsResponse | undefined,
  state: SeriesComparisonUrlState,
): string {
  const selectedSeries = findSelectedSeries(options, state.gameTitleId);
  if (!selectedSeries) {
    return "";
  }
  if (!state.seasonMasterId && !state.mapMasterId) {
    return "総合";
  }
  const seasonName =
    (selectedSeries.seasons ?? []).find((item) => item.id === state.seasonMasterId)?.name ??
    "全シーズン";
  const mapName =
    (selectedSeries.maps ?? []).find((item) => item.id === state.mapMasterId)?.name ?? "全マップ";
  return `${seasonName} / ${mapName}`;
}
