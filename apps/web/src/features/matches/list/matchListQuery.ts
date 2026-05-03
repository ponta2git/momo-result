import type { ListMatchesQuery } from "@/features/matches/api";
import { listMatches } from "@/features/matches/api";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";

export function buildMatchListApiQuery(search: MatchListSearch): ListMatchesQuery {
  return {
    ...(search.gameTitleId ? { gameTitleId: search.gameTitleId } : {}),
    ...(search.heldEventId ? { heldEventId: search.heldEventId } : {}),
    ...(search.seasonMasterId ? { seasonMasterId: search.seasonMasterId } : {}),
    ...(search.status !== "all" ? { status: search.status } : {}),
  };
}

export function buildMatchListSummaryQuery(search: MatchListSearch): ListMatchesQuery {
  return {
    ...(search.gameTitleId ? { gameTitleId: search.gameTitleId } : {}),
    ...(search.heldEventId ? { heldEventId: search.heldEventId } : {}),
    ...(search.seasonMasterId ? { seasonMasterId: search.seasonMasterId } : {}),
  };
}

export async function fetchMatchList(search: MatchListSearch) {
  return listMatches(buildMatchListApiQuery(search));
}

export async function fetchMatchListSummary(search: MatchListSearch) {
  return listMatches(buildMatchListSummaryQuery(search));
}
