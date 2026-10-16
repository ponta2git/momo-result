import { defaultOwnerMetric } from "@/features/seriesComparison/model/seriesAnalysisOwnerMetrics";
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

export type SeriesAnalysisSelection = {
  ownerMetric?: OwnerMetricId | undefined;
  focusMatchId?: string | undefined;
  focusMemberId?: string | undefined;
  rivalMemberId?: string | undefined;
  gameTitleId?: string | undefined;
  mapMasterId?: string | undefined;
  seasonMasterId?: string | undefined;
  view?: SeriesAnalysisViewId | undefined;
};

export type SeriesAnalysisSelectionChange =
  | { kind: "title"; gameTitleId: string }
  | { kind: "season"; seasonMasterId: string }
  | { kind: "map"; mapMasterId: string }
  | { kind: "view"; view: SeriesAnalysisViewId }
  | { kind: "ownerMetric"; ownerMetric: OwnerMetricId }
  | { kind: "focus"; matchId: string | undefined }
  | { kind: "clearScope" }
  | { kind: "member"; role: "focus" | "rival"; memberId: string };

/** A changed scope cannot inherit a match from the previous comparison. */
export function changeSeriesAnalysisSelection(
  current: SeriesAnalysisSelection,
  change: SeriesAnalysisSelectionChange,
): SeriesAnalysisSelection {
  switch (change.kind) {
    case "title":
      return {
        gameTitleId: change.gameTitleId,
        view: current.view ?? defaultSeriesAnalysisView,
        ownerMetric: current.ownerMetric,
      };
    case "season":
      return {
        ...current,
        focusMatchId: undefined,
        seasonMasterId: change.seasonMasterId || undefined,
      };
    case "map":
      return { ...current, focusMatchId: undefined, mapMasterId: change.mapMasterId || undefined };
    case "view":
      return { ...current, view: change.view };
    case "ownerMetric":
      return { ...current, ownerMetric: change.ownerMetric };
    case "focus":
      return { ...current, focusMatchId: change.matchId };
    case "clearScope":
      return {
        ...current,
        focusMatchId: undefined,
        mapMasterId: undefined,
        seasonMasterId: undefined,
      };
    case "member":
      return {
        ...current,
        [change.role === "focus" ? "focusMemberId" : "rivalMemberId"]: change.memberId,
      };
  }
}

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

export function normalizeSeriesAnalysisView(value: string | undefined): SeriesAnalysisViewId {
  return isSeriesAnalysisViewId(value) ? value : defaultSeriesAnalysisView;
}

export function findSeriesAnalysisTitle(
  options: SeriesAnalysisOptionsResponse | undefined,
  gameTitleId: string | undefined,
) {
  return options?.titles.find((title) => title.gameTitleId === gameTitleId);
}

export function normalizeSeriesAnalysisSelection(
  options: SeriesAnalysisOptionsResponse | undefined,
  state: SeriesAnalysisSelection,
): SeriesAnalysisSelection {
  const titles = options?.titles ?? [];
  const selectedTitle =
    titles.find((title) => title.gameTitleId === state.gameTitleId) ??
    titles.find((title) => title.gameTitleId === options?.defaultGameTitleId) ??
    titles[0];
  const view = normalizeSeriesAnalysisView(state.view);
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
  state: SeriesAnalysisSelection,
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
