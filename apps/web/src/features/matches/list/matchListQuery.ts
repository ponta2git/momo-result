import type { ListMatchesQuery } from "@/features/matches/api";
import { listMatches } from "@/features/matches/api";
import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import { compact } from "@/shared/lib/compact";

export function buildMatchListApiQuery(search: MatchListSearch): ListMatchesQuery {
  return compact({
    gameTitleId: search.gameTitleId || undefined,
    heldEventId: search.heldEventId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
    status: search.status !== "all" ? search.status : undefined,
  });
}

export function buildMatchListSummaryQuery(search: MatchListSearch): ListMatchesQuery {
  return compact({
    gameTitleId: search.gameTitleId || undefined,
    heldEventId: search.heldEventId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
  });
}

export async function fetchMatchList(search: MatchListSearch) {
  return listMatches(buildMatchListApiQuery(search));
}

export async function fetchMatchListSummary(search: MatchListSearch) {
  return listMatches(buildMatchListSummaryQuery(search));
}
