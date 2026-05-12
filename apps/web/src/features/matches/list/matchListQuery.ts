import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { listMatches } from "@/shared/api/matches";
import { compact } from "@/shared/lib/compact";

export function buildMatchListApiQuery(search: MatchListSearch): ListMatchesQuery {
  return compact({
    gameTitleId: search.gameTitleId || undefined,
    heldEventId: search.heldEventId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
    status: search.status === "all" ? undefined : search.status,
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
