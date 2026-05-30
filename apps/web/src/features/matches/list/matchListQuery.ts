import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import type { ListMatchesQuery } from "@/shared/api/matches";
import { getMatchListSummary, listMatches } from "@/shared/api/matches";
import { compact } from "@/shared/lib/compact";

export function buildMatchListApiQuery(search: MatchListSearch): ListMatchesQuery {
  return compact({
    gameTitleId: search.gameTitleId || undefined,
    heldEventId: search.heldEventId || undefined,
    seasonMasterId: search.seasonMasterId || undefined,
    page: search.page,
    pageSize: search.pageSize,
    sort: search.sort,
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

export async function fetchMatchList(search: MatchListSearch, signal?: AbortSignal) {
  return listMatches(buildMatchListApiQuery(search), signal ? { signal } : {});
}

export async function fetchMatchListSummary(search: MatchListSearch, signal?: AbortSignal) {
  return getMatchListSummary(buildMatchListSummaryQuery(search), signal ? { signal } : {});
}
