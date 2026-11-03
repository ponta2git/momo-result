import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";

export type MatchComparisonLinkSource = {
  gameTitleId: string;
  mapMasterId: string;
  matchId: string;
  seasonMasterId: string;
};

export function seriesComparisonHrefForMatch(match: MatchComparisonLinkSource): string {
  const params = new URLSearchParams({
    gameTitleId: match.gameTitleId,
    seasonMasterId: match.seasonMasterId,
    mapMasterId: match.mapMasterId,
    focusMatchId: match.matchId,
    view: "flow",
  });
  return `/analytics/series?${params.toString()}`;
}

/** The app's entry, which opens the newest held event: the night's record destination. */
export const recordEntryHref = "/";

export type MatchRecordMethod = "ocr" | "manual";

/** Recording starts inside a held event, and every way in carries the event the same way. */
export function matchRecordHref(heldEventId: string, method: MatchRecordMethod): string {
  const params = new URLSearchParams({ heldEventId });
  return `${method === "ocr" ? "/ocr/new" : "/matches/new"}?${params.toString()}`;
}

/**
 * Leaving an unfinished record returns to the held event it is recorded into, or to the matches
 * when it has none.
 */
export function recordExitHref(heldEventId: string | undefined, publicId?: string): string {
  return heldEventId ? heldEventDetailHref(heldEventId, publicId) : "/matches";
}
