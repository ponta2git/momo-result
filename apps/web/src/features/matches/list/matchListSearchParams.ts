import type {
  MatchListSearch,
  MatchListSort,
  MatchListStatusFilter,
} from "@/features/matches/list/matchListTypes";

export const defaultMatchListSearch: MatchListSearch = {
  heldEventId: "",
  gameTitleId: "",
  page: 1,
  pageSize: 25,
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

const pageSizeOptions = new Set([25, 50, 100, 200]);

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

export function parseMatchListSearchParams(searchParams: URLSearchParams): MatchListSearch {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort");

  return {
    heldEventId: searchParams.get("heldEventId") ?? "",
    gameTitleId: searchParams.get("gameTitleId") ?? "",
    page: parsePositiveInt(searchParams.get("page"), defaultMatchListSearch.page),
    pageSize: pageSizeOptions.has(Number(searchParams.get("pageSize")))
      ? Number(searchParams.get("pageSize"))
      : defaultMatchListSearch.pageSize,
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
  if (search.page !== defaultMatchListSearch.page) {
    params.set("page", String(search.page));
  }
  if (search.pageSize !== defaultMatchListSearch.pageSize) {
    params.set("pageSize", String(search.pageSize));
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
