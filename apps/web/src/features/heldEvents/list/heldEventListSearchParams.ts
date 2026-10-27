import {
  isCompleteHeldEventListMetric,
  isHeldEventListMetric,
  parseHeldEventListMetricValue,
  parseHeldEventListMinMatchCount,
} from "@/features/heldEvents/list/heldEventListConditions";
import type {
  HeldEventListMetricCondition,
  HeldEventListSearch,
} from "@/features/heldEvents/list/heldEventListTypes";
import { isFixedMemberId } from "@/shared/domain/members";
import { parsePositiveIntSearchParam, trimSearchParam } from "@/shared/lib/searchParams";
import {
  parseHeldOrderSort,
  parseMatchNoteQuery,
  parseSearchPeriod,
} from "@/shared/matches/matchSearchConditions";

export const heldEventListPageSizeOptions = [10, 25, 50] as const;

export const emptyHeldEventListMetricCondition: HeldEventListMetricCondition = {
  memberId: "",
  metric: "",
  range: "gte",
  value: "",
};

export const defaultHeldEventListSearch: HeldEventListSearch = {
  from: "",
  gameTitleId: "",
  mapMasterId: "",
  metric: emptyHeldEventListMetricCondition,
  minMatchCount: 0,
  page: 1,
  pageSize: 10,
  q: "",
  seasonMasterId: "",
  sort: "held_desc",
  to: "",
};

const pageSizeOptions = new Set<number>(heldEventListPageSizeOptions);

function parseMetric(searchParams: URLSearchParams): HeldEventListMetricCondition {
  const metric = searchParams.get("metric") ?? "";
  if (!isHeldEventListMetric(metric)) return emptyHeldEventListMetricCondition;
  const value = parseHeldEventListMetricValue(metric, searchParams.get("metricValue") ?? "");
  if (value === undefined) return emptyHeldEventListMetricCondition;
  const memberId = trimSearchParam(searchParams.get("memberId")) ?? "";
  return {
    memberId: isFixedMemberId(memberId) ? memberId : "",
    metric,
    range: searchParams.get("metricRange") === "lte" ? "lte" : "gte",
    value,
  };
}

export function parseHeldEventListSearchParams(searchParams: URLSearchParams): HeldEventListSearch {
  const pageSize = parsePositiveIntSearchParam(
    searchParams.get("pageSize"),
    defaultHeldEventListSearch.pageSize,
  );
  return {
    ...parseSearchPeriod(searchParams),
    gameTitleId: trimSearchParam(searchParams.get("gameTitleId")) ?? "",
    mapMasterId: trimSearchParam(searchParams.get("mapMasterId")) ?? "",
    metric: parseMetric(searchParams),
    minMatchCount: parseHeldEventListMinMatchCount(searchParams.get("minMatchCount")),
    page: parsePositiveIntSearchParam(searchParams.get("page"), defaultHeldEventListSearch.page),
    pageSize: pageSizeOptions.has(pageSize) ? pageSize : defaultHeldEventListSearch.pageSize,
    q: parseMatchNoteQuery(searchParams.get("q")),
    seasonMasterId: trimSearchParam(searchParams.get("seasonMasterId")) ?? "",
    sort: parseHeldOrderSort(searchParams.get("sort")),
  };
}

export function buildHeldEventListSearchParams(search: HeldEventListSearch): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value) params.set(key, value);
  };

  set("gameTitleId", search.gameTitleId);
  set("seasonMasterId", search.seasonMasterId);
  set("mapMasterId", search.mapMasterId);
  set("from", search.from);
  set("to", search.to);
  if (search.minMatchCount > 0) params.set("minMatchCount", String(search.minMatchCount));
  set("q", search.q);
  if (isCompleteHeldEventListMetric(search.metric)) {
    set("memberId", search.metric.memberId);
    params.set("metric", search.metric.metric);
    params.set(
      "metricValue",
      parseHeldEventListMetricValue(search.metric.metric, search.metric.value) ?? "",
    );
    if (search.metric.range !== "gte") params.set("metricRange", search.metric.range);
  }
  if (search.sort !== defaultHeldEventListSearch.sort) params.set("sort", search.sort);
  if (search.page !== defaultHeldEventListSearch.page) params.set("page", String(search.page));
  if (search.pageSize !== defaultHeldEventListSearch.pageSize) {
    params.set("pageSize", String(search.pageSize));
  }
  return params;
}

/** Conditions narrow the result set; sort and paging do not. */
export function hasHeldEventListConditions(search: HeldEventListSearch): boolean {
  return (
    search.gameTitleId.length > 0 ||
    search.seasonMasterId.length > 0 ||
    search.mapMasterId.length > 0 ||
    search.from.length > 0 ||
    search.to.length > 0 ||
    search.minMatchCount > 0 ||
    search.q.length > 0 ||
    isCompleteHeldEventListMetric(search.metric)
  );
}
