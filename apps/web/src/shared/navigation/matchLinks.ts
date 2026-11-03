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

export type MatchRecordMethod = "ocr" | "manual";

/** Recording starts inside a held event, and every way in carries the event the same way. */
export function matchRecordHref(heldEventId: string, method: MatchRecordMethod): string {
  const params = new URLSearchParams({ heldEventId });
  return `${method === "ocr" ? "/ocr/new" : "/matches/new"}?${params.toString()}`;
}
