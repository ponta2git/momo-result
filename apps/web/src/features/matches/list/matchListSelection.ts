import { isCompleteMatchListRecord } from "@/features/matches/list/matchListConditions";
import {
  defaultMatchListSearch,
  emptyMatchListRecordCondition,
} from "@/features/matches/list/matchListSearchParams";
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

/** A title change keeps dependent season / map only when the title itself is unchanged. */
function withGameTitle(current: MatchListSearch, gameTitleId: string): MatchListSearch {
  const sameTitle = gameTitleId !== "" && gameTitleId === current.gameTitleId;
  return {
    ...current,
    gameTitleId,
    mapMasterId: sameTitle ? current.mapMasterId : "",
    seasonMasterId: sameTitle ? current.seasonMasterId : "",
  };
}

/** Apply a user's changed field to the latest URL; every condition change resets paging. */
export function changeMatchListSelection(
  current: MatchListSearch,
  change: MatchListSelectionChange,
): MatchListSearch | undefined {
  const next = applyChange(current, change);
  return next && change.kind !== "page" ? { ...next, cursor: "" } : next;
}

function applyChange(
  current: MatchListSearch,
  change: MatchListSelectionChange,
): MatchListSearch | undefined {
  switch (change.kind) {
    case "page": {
      const cursor = cursorForPage(change.pagination, change.page);
      return cursor === undefined ? undefined : { ...current, cursor };
    }
    case "pageSize":
      return { ...current, pageSize: change.pageSize };
    case "sort":
      return { ...current, sort: change.sort };
    case "gameTitle":
      return withGameTitle(current, change.gameTitleId);
    case "season":
      return { ...current, seasonMasterId: change.seasonMasterId };
    case "map":
      return { ...current, mapMasterId: change.mapMasterId };
    case "heldEvent":
      return { ...current, heldEventId: change.heldEventId };
    case "period":
      return change.from && change.to && change.from > change.to
        ? undefined
        : { ...current, from: change.from, to: change.to };
    case "memo":
      return { ...current, q: change.q };
    case "record":
      return {
        ...current,
        record: isCompleteMatchListRecord(change.record)
          ? change.record
          : emptyMatchListRecordCondition,
      };
    case "conditions":
      return { ...change.search, cursor: "", pageSize: current.pageSize };
    case "removeCondition":
      switch (change.condition) {
        case "gameTitle":
          return withGameTitle(current, "");
        case "season":
          return { ...current, seasonMasterId: "" };
        case "map":
          return { ...current, mapMasterId: "" };
        case "heldEvent":
          return { ...current, heldEventId: "" };
        case "period":
          return { ...current, from: "", to: "" };
        case "memo":
          return { ...current, q: "" };
        case "record":
          return { ...current, record: emptyMatchListRecordCondition };
      }
  }
}

/** Clearing conditions keeps the reader's sort and page size. */
export function clearMatchListConditions(current: MatchListSearch): MatchListSearch {
  return { ...defaultMatchListSearch, pageSize: current.pageSize, sort: current.sort };
}
