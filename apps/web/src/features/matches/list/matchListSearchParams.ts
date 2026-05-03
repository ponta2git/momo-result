import type {
  MatchListSearch,
  MatchListSort,
  MatchListStatusFilter,
} from "@/features/matches/list/matchListTypes";

export const defaultMatchListSearch: MatchListSearch = {
  heldEventId: "",
  gameTitleId: "",
  seasonMasterId: "",
  status: "all",
  sort: "status_priority",
};

const statusOptions = new Set<MatchListStatusFilter>([
  "all",
  "incomplete",
  "ocr_running",
  "pre_confirm",
  "needs_review",
  "confirmed",
]);

const sortOptions = new Set<MatchListSort>([
  "status_priority",
  "updated_desc",
  "held_desc",
  "held_asc",
  "match_no_asc",
]);

export function parseMatchListSearchParams(searchParams: URLSearchParams): MatchListSearch {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort");

  return {
    heldEventId: searchParams.get("heldEventId") ?? "",
    gameTitleId: searchParams.get("gameTitleId") ?? "",
    seasonMasterId: searchParams.get("seasonMasterId") ?? "",
    status:
      status && statusOptions.has(status as MatchListStatusFilter)
        ? (status as MatchListStatusFilter)
        : defaultMatchListSearch.status,
    sort:
      sort && sortOptions.has(sort as MatchListSort)
        ? (sort as MatchListSort)
        : defaultMatchListSearch.sort,
  };
}

export function buildMatchListSearchParams(search: MatchListSearch): URLSearchParams {
  const params = new URLSearchParams();

  if (search.status !== defaultMatchListSearch.status) {
    params.set("status", search.status);
  }
  if (search.heldEventId) {
    params.set("heldEventId", search.heldEventId);
  }
  if (search.gameTitleId) {
    params.set("gameTitleId", search.gameTitleId);
  }
  if (search.seasonMasterId) {
    params.set("seasonMasterId", search.seasonMasterId);
  }
  if (search.sort !== defaultMatchListSearch.sort) {
    params.set("sort", search.sort);
  }

  return params;
}

export function hasMatchListFilters(search: MatchListSearch): boolean {
  return (
    search.status !== defaultMatchListSearch.status ||
    search.heldEventId.length > 0 ||
    search.gameTitleId.length > 0 ||
    search.seasonMasterId.length > 0
  );
}
