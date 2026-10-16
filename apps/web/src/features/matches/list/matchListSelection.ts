import type { MatchListSearch } from "@/features/matches/list/matchListTypes";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import type { PaginationState } from "@/shared/lib/pagination";

export type MatchListSelectionChange =
  | { kind: "page"; page: number; pagination: PaginationState }
  | { kind: "pageSize"; pageSize: number };

/** Pagination changes preserve filters; a new page size starts from the first page. */
export function changeMatchListSelection(
  current: MatchListSearch,
  change: MatchListSelectionChange,
): MatchListSearch | undefined {
  if (change.kind === "pageSize") return { ...current, cursor: "", pageSize: change.pageSize };
  const cursor = cursorForPage(change.pagination, change.page);
  return cursor === undefined ? undefined : { ...current, cursor };
}
