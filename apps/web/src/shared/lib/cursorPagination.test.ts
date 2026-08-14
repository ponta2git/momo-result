// @vitest-environment node
import { describe, expect, it } from "vitest";

import { cursorForPage } from "@/shared/lib/cursorPagination";

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

describe("cursorForPage", () => {
  it("maps the numbered first/previous/next/last UX to server-issued cursor edges", () => {
    expect(cursorForPage(pagination, 1)).toBe("");
    expect(cursorForPage(pagination, 4)).toBe("before-current");
    expect(cursorForPage(pagination, 6)).toBe("after-current");
    expect(cursorForPage(pagination, 21)).toBe("last-boundary");
  });

  it("does not invent a cursor for arbitrary or unavailable navigation", () => {
    const { nextCursor, ...paginationWithoutNextCursor } = pagination;

    expect(nextCursor).toBe("after-current");
    expect(cursorForPage(pagination, 5)).toBeUndefined();
    expect(cursorForPage(pagination, 10)).toBeUndefined();
    expect(cursorForPage(paginationWithoutNextCursor, pagination.page + 1)).toBeUndefined();
  });
});
