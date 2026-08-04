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
