import { isCompleteHeldEventListMetric } from "@/features/heldEvents/list/heldEventListConditions";
import {
  defaultHeldEventListSearch,
  emptyHeldEventListMetricCondition,
} from "@/features/heldEvents/list/heldEventListSearchParams";
import type {
  HeldEventListFilterChange,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";

export type HeldEventListSelectionChange =
  | HeldEventListFilterChange
  | { kind: "page"; page: number }
  | { kind: "pageSize"; pageSize: number };

/** A title change keeps dependent season / map only when the title itself is unchanged. */
function withGameTitle(current: HeldEventListSearch, gameTitleId: string): HeldEventListSearch {
  const sameTitle = gameTitleId !== "" && gameTitleId === current.gameTitleId;
  return {
    ...current,
    gameTitleId,
    mapMasterId: sameTitle ? current.mapMasterId : "",
    seasonMasterId: sameTitle ? current.seasonMasterId : "",
  };
}

/** Apply a user's changed field to the latest URL; every change other than paging resets the page. */
export function changeHeldEventListSelection(
  current: HeldEventListSearch,
  change: HeldEventListSelectionChange,
): HeldEventListSearch | undefined {
  const next = applyChange(current, change);
  return next && change.kind !== "page" ? { ...next, page: 1 } : next;
}

function applyChange(
  current: HeldEventListSearch,
  change: HeldEventListSelectionChange,
): HeldEventListSearch | undefined {
  switch (change.kind) {
    case "page":
      return Number.isSafeInteger(change.page) && change.page >= 1
        ? { ...current, page: change.page }
        : undefined;
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
    case "period":
      return change.from && change.to && change.from > change.to
        ? undefined
        : { ...current, from: change.from, to: change.to };
    case "matchCount":
      return { ...current, minMatchCount: Math.max(0, change.minMatchCount) };
    case "memo":
      return { ...current, q: change.q };
    case "metric":
      return {
        ...current,
        metric: isCompleteHeldEventListMetric(change.metric)
          ? change.metric
          : emptyHeldEventListMetricCondition,
      };
    case "conditions":
      return {
        ...change.search,
        metric: isCompleteHeldEventListMetric(change.search.metric)
          ? change.search.metric
          : emptyHeldEventListMetricCondition,
        pageSize: current.pageSize,
      };
    case "removeCondition":
      switch (change.condition) {
        case "gameTitle":
          return withGameTitle(current, "");
        case "season":
          return { ...current, seasonMasterId: "" };
        case "map":
          return { ...current, mapMasterId: "" };
        case "period":
          return { ...current, from: "", to: "" };
        case "matchCount":
          return { ...current, minMatchCount: 0 };
        case "memo":
          return { ...current, q: "" };
        case "metric":
          return { ...current, metric: emptyHeldEventListMetricCondition };
      }
  }
}

/** Clearing conditions keeps the reader's sort and page size. */
export function clearHeldEventListConditions(current: HeldEventListSearch): HeldEventListSearch {
  return { ...defaultHeldEventListSearch, pageSize: current.pageSize, sort: current.sort };
}
