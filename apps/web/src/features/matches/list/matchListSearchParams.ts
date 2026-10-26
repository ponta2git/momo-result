import {
  isCompleteMatchListRecord,
  isMatchListDate,
  isMatchListRecord,
} from "@/features/matches/list/matchListConditions";
import type {
  MatchListRecordCondition,
  MatchListSearch,
  MatchListSort,
} from "@/features/matches/list/matchListTypes";
import { isFixedMemberId } from "@/shared/domain/members";
import { parsePositiveIntSearchParam, trimSearchParam } from "@/shared/lib/searchParams";

export const emptyMatchListRecordCondition: MatchListRecordCondition = {
  memberId: "",
  range: "gte",
  record: "",
  value: "",
};

export const defaultMatchListSearch: MatchListSearch = {
  cursor: "",
  from: "",
  gameTitleId: "",
  heldEventId: "",
  mapMasterId: "",
  pageSize: 25,
  q: "",
  record: emptyMatchListRecordCondition,
  seasonMasterId: "",
  sort: "held_desc",
  to: "",
};

/** The API rejects longer memo queries; the input enforces the same bound. */
export const matchListMemoQueryMaxLength = 50;

export const matchListPageSizeOptions = [25, 50, 100] as const;

const pageSizeOptions = new Set<number>(matchListPageSizeOptions);
const sortOptions = new Set<MatchListSort>(["held_desc", "held_asc"]);
export function normalizeMatchListMemoQuery(value: string): string {
  return value.trim();
}

function parseMemoQuery(value: string | null): string {
  const q = normalizeMatchListMemoQuery(value ?? "");
  return [...q].length <= matchListMemoQueryMaxLength ? q : "";
}

function parsePeriod(searchParams: URLSearchParams): { from: string; to: string } {
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const validFrom = isMatchListDate(from) ? from : "";
  const validTo = isMatchListDate(to) ? to : "";
  return validFrom && validTo && validFrom > validTo
    ? { from: "", to: "" }
    : { from: validFrom, to: validTo };
}

function parseRecord(searchParams: URLSearchParams): MatchListRecordCondition {
  const record = searchParams.get("record") ?? "";
  if (!isMatchListRecord(record)) return emptyMatchListRecordCondition;
  const condition: MatchListRecordCondition = {
    memberId: trimSearchParam(searchParams.get("memberId")) ?? "",
    range: searchParams.get("recordRange") === "lte" ? "lte" : "gte",
    record,
    value: (searchParams.get("recordValue") ?? "").trim(),
  };
  if (!isCompleteMatchListRecord(condition)) return emptyMatchListRecordCondition;
  return condition.memberId && !isFixedMemberId(condition.memberId)
    ? { ...condition, memberId: "" }
    : condition;
}

export function parseMatchListSearchParams(searchParams: URLSearchParams): MatchListSearch {
  const sort = searchParams.get("sort");
  const pageSize = parsePositiveIntSearchParam(
    searchParams.get("pageSize"),
    defaultMatchListSearch.pageSize,
  );

  return {
    cursor: parseCursor(searchParams.get("cursor")),
    ...parsePeriod(searchParams),
    gameTitleId: trimSearchParam(searchParams.get("gameTitleId")) ?? "",
    heldEventId: trimSearchParam(searchParams.get("heldEventId")) ?? "",
    mapMasterId: trimSearchParam(searchParams.get("mapMasterId")) ?? "",
    pageSize: pageSizeOptions.has(pageSize) ? pageSize : defaultMatchListSearch.pageSize,
    q: parseMemoQuery(searchParams.get("q")),
    record: parseRecord(searchParams),
    seasonMasterId: trimSearchParam(searchParams.get("seasonMasterId")) ?? "",
    sort:
      sort && sortOptions.has(sort as MatchListSort)
        ? (sort as MatchListSort)
        : defaultMatchListSearch.sort,
  };
}

export function buildMatchListSearchParams(search: MatchListSearch): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string) => {
    if (value) params.set(key, value);
  };

  set("gameTitleId", search.gameTitleId);
  set("seasonMasterId", search.seasonMasterId);
  set("mapMasterId", search.mapMasterId);
  set("heldEventId", search.heldEventId);
  set("from", search.from);
  set("to", search.to);
  set("q", search.q);
  if (isCompleteMatchListRecord(search.record)) {
    set("memberId", search.record.memberId);
    params.set("record", search.record.record);
    params.set("recordValue", search.record.value.trim());
    if (search.record.range !== "gte") params.set("recordRange", search.record.range);
  }
  if (search.sort !== defaultMatchListSearch.sort) params.set("sort", search.sort);
  set("cursor", search.cursor);
  if (search.pageSize !== defaultMatchListSearch.pageSize) {
    params.set("pageSize", String(search.pageSize));
  }

  return params;
}

function parseCursor(value: string | null): string {
  const cursor = value?.trim() ?? "";
  return cursor.length <= 4096 ? cursor : "";
}

/** Conditions narrow the result set; sort and paging do not. */
export function hasMatchListConditions(search: MatchListSearch): boolean {
  return (
    search.gameTitleId.length > 0 ||
    search.seasonMasterId.length > 0 ||
    search.mapMasterId.length > 0 ||
    search.heldEventId.length > 0 ||
    search.from.length > 0 ||
    search.to.length > 0 ||
    search.q.length > 0 ||
    isCompleteMatchListRecord(search.record)
  );
}
