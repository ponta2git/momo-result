// @vitest-environment node
import { describe, expect, it } from "vitest";

import { cursorForMatchPage } from "@/features/matches/list/matchListPagination";

const pagination = {
  hasNextPage: true,
  hasPreviousPage: true,
  lastCursor: "last-boundary",
  nextCursor: "after-current",
  page: 5,
  pageSize: 25,
  previousCursor: "before-current",
  totalItems: 503,
  totalPages: 21,
};

describe("cursorForMatchPage", () => {
  it("maps the numbered first/previous/next/last UX to server-issued cursor edges", () => {
    expect(cursorForMatchPage(pagination, 1)).toBe("");
    expect(cursorForMatchPage(pagination, 4)).toBe("before-current");
    expect(cursorForMatchPage(pagination, 6)).toBe("after-current");
    expect(cursorForMatchPage(pagination, 21)).toBe("last-boundary");
  });

  it("does not invent a cursor for arbitrary or unavailable navigation", () => {
    expect(cursorForMatchPage(pagination, 5)).toBeUndefined();
    expect(cursorForMatchPage(pagination, 10)).toBeUndefined();
    expect(
      cursorForMatchPage({ ...pagination, nextCursor: null }, pagination.page + 1),
    ).toBeUndefined();
  });
});
