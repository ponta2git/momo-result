import type {
  MatchListFilterChange,
  MatchListSearch,
} from "@/features/matches/list/matchListTypes";
import { cursorForPage } from "@/shared/lib/cursorPagination";
import type { PaginationState } from "@/shared/lib/pagination";

export type MatchListSelectionChange =
  | MatchListFilterChange
  | { kind: "page"; page: number; pagination: PaginationState }
  | { kind: "pageSize"; pageSize: number };

/** Apply a user's changed field to the latest URL; filters reset paging and title scopes season. */
export function changeMatchListSelection(
  current: MatchListSearch,
  change: MatchListSelectionChange,
): MatchListSearch | undefined {
  switch (change.kind) {
    case "page": {
      const cursor = cursorForPage(change.pagination, change.page);
      return cursor === undefined ? undefined : { ...current, cursor };
    }
    case "pageSize":
      return { ...current, cursor: "", pageSize: change.pageSize };
    case "status":
      return { ...current, cursor: "", status: change.status };
    case "sort":
      return { ...current, cursor: "", sort: change.sort };
    case "heldEvent":
      return { ...current, cursor: "", heldEventId: change.heldEventId };
    case "gameTitle":
      return {
        ...current,
        cursor: "",
        gameTitleId: change.gameTitleId,
        seasonMasterId:
          change.gameTitleId && change.gameTitleId === current.gameTitleId
            ? current.seasonMasterId
            : "",
      };
    case "season":
      return { ...current, cursor: "", seasonMasterId: change.seasonMasterId };
  }
}
