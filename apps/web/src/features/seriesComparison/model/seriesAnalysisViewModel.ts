import {
  defaultOwnerMetric,
  isOwnerMetricId,
} from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import type { OwnerMetricId } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
import type {
  SeriesAnalysisOptionsResponse,
  SeriesAnalysisQuery,
} from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds, isFixedMemberId } from "@/shared/domain/members";

export type SeriesAnalysisViewId =
  | "context"
  | "drivers"
  | "flow"
  | "overview"
  | "review"
  | "outlook";

export type SeriesAnalysisUrlState = {
  ownerMetric?: OwnerMetricId | undefined;
  focusMatchId?: string | undefined;
  focusMemberId?: string | undefined;
  rivalMemberId?: string | undefined;
  gameTitleId?: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  view?: SeriesAnalysisViewId | undefined;
};

const viewIds = new Set(["review", "overview", "flow", "drivers", "context", "outlook"]);

export function normalizeOutlookPair(focus?: string, rival?: string) {
  const validFocus = focus && isFixedMemberId(focus) ? focus : undefined;
  const validRival = rival && isFixedMemberId(rival) ? rival : undefined;
  const focusMemberId =
    validFocus ??
    (canonicalResultMemberIds[0] === validRival
      ? canonicalResultMemberIds[1]
      : canonicalResultMemberIds[0]);
  const rivalMemberId =
    validRival && validRival !== focusMemberId
      ? validRival
      : canonicalResultMemberIds[0] === focusMemberId
        ? canonicalResultMemberIds[1]
        : canonicalResultMemberIds[0];
  return { focusMemberId, rivalMemberId };
}

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
  const rawMetric = params.get("ownerMetric");
  const ownerMetric = isOwnerMetricId(rawMetric) ? rawMetric : defaultOwnerMetric;
  const focusMemberId = params.get("focusMemberId")?.trim() || undefined;
  const rivalMemberId = params.get("rivalMemberId")?.trim() || undefined;
  return {
    focusMatchId,
    gameTitleId,
    mapMasterId,
    seasonMasterId,
    view,
    ownerMetric,
    ...(focusMemberId ? { focusMemberId } : {}),
    ...(rivalMemberId ? { rivalMemberId } : {}),
  };
}

export function buildSeriesAnalysisSearchParams(state: SeriesAnalysisUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.ownerMetric && state.ownerMetric !== defaultOwnerMetric)
    params.set("ownerMetric", state.ownerMetric);
  if (state.gameTitleId) params.set("gameTitleId", state.gameTitleId);
  if (state.seasonMasterId) params.set("seasonMasterId", state.seasonMasterId);
  if (state.mapMasterId) params.set("mapMasterId", state.mapMasterId);
  if (state.focusMatchId) params.set("focusMatchId", state.focusMatchId);
  if (state.focusMemberId) params.set("focusMemberId", state.focusMemberId);
  if (state.rivalMemberId) params.set("rivalMemberId", state.rivalMemberId);
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
  const ownerMetric = state.ownerMetric ?? defaultOwnerMetric;
  if (!selectedTitle) return { view, ownerMetric };

  const seasonMasterId = selectedTitle.seasons.some(
    (season) => season.seasonMasterId === state.seasonMasterId,
  )
    ? state.seasonMasterId
    : undefined;
  const mapMasterId = selectedTitle.maps.some((map) => map.mapMasterId === state.mapMasterId)
    ? state.mapMasterId
    : undefined;
  const scopeWasNormalized =
    (state.gameTitleId !== undefined && state.gameTitleId !== selectedTitle.gameTitleId) ||
    state.seasonMasterId !== seasonMasterId ||
    state.mapMasterId !== mapMasterId;
  return {
    ...(state.focusMatchId && !scopeWasNormalized ? { focusMatchId: state.focusMatchId } : {}),
    ...(view === "outlook" || state.focusMemberId || state.rivalMemberId
      ? normalizeOutlookPair(state.focusMemberId, state.rivalMemberId)
      : {}),
    ownerMetric,
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
