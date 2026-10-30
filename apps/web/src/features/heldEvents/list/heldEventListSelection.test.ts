// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  defaultHeldEventListSearch,
  emptyHeldEventListMetricCondition,
} from "@/features/heldEvents/list/heldEventListSearchParams";
import {
  changeHeldEventListSelection,
  clearHeldEventListConditions,
} from "@/features/heldEvents/list/heldEventListSelection";
import type { HeldEventListSearch } from "@/features/heldEvents/list/heldEventListTypes";

const scoped: HeldEventListSearch = {
  ...defaultHeldEventListSearch,
  gameTitleId: "game-1",
  mapMasterId: "map-1",
  page: 3,
  pageSize: 25,
  q: "ボンビー",
  seasonMasterId: "season-1",
  sort: "held_asc",
};

describe("changeHeldEventListSelection", () => {
  it("returns to the first page whenever a condition, sort or page size changes", () => {
    expect(changeHeldEventListSelection(scoped, { kind: "memo", q: "銀次" })).toMatchObject({
      page: 1,
      q: "銀次",
    });
    expect(changeHeldEventListSelection(scoped, { kind: "sort", sort: "held_desc" })).toMatchObject(
      { page: 1, sort: "held_desc" },
    );
    expect(changeHeldEventListSelection(scoped, { kind: "pageSize", pageSize: 50 })).toMatchObject({
      page: 1,
      pageSize: 50,
    });
    expect(changeHeldEventListSelection(scoped, { kind: "page", page: 4 })).toMatchObject({
      page: 4,
      q: "ボンビー",
    });
  });

  it("clears season and map when the title changes, and keeps them for the same title", () => {
    expect(
      changeHeldEventListSelection(scoped, { kind: "gameTitle", gameTitleId: "game-2" }),
    ).toMatchObject({ gameTitleId: "game-2", mapMasterId: "", seasonMasterId: "" });
    expect(
      changeHeldEventListSelection(scoped, { kind: "gameTitle", gameTitleId: "game-1" }),
    ).toMatchObject({ mapMasterId: "map-1", seasonMasterId: "season-1" });
    expect(
      changeHeldEventListSelection(scoped, { kind: "removeCondition", condition: "gameTitle" }),
    ).toMatchObject({ gameTitleId: "", mapMasterId: "", seasonMasterId: "" });
  });

  it("rejects an inverted period and an invalid page", () => {
    expect(
      changeHeldEventListSelection(scoped, {
        kind: "period",
        from: "2026-04-02",
        to: "2026-04-01",
      }),
    ).toBeUndefined();
    expect(changeHeldEventListSelection(scoped, { kind: "page", page: 0 })).toBeUndefined();
  });

  it("keeps only a complete metric condition", () => {
    const metric = { memberId: "member_ponta", metric: "average_rank", range: "lte", value: "2" };
    expect(
      changeHeldEventListSelection(scoped, {
        kind: "metric",
        metric: { ...metric, metric: "average_rank" as const, range: "lte" as const },
      })?.metric,
    ).toEqual(metric);
    expect(
      changeHeldEventListSelection(scoped, {
        kind: "metric",
        metric: { memberId: "", metric: "rank1_count", range: "gte", value: "x" },
      })?.metric,
    ).toEqual(emptyHeldEventListMetricCondition);
  });

  it("applies a sheet draft with the reader's page size and only complete conditions", () => {
    const next = changeHeldEventListSelection(scoped, {
      kind: "conditions",
      search: {
        ...defaultHeldEventListSearch,
        metric: { memberId: "", metric: "rank2_count", range: "gte", value: "" },
        minMatchCount: 2,
        page: 9,
      },
    });
    expect(next).toEqual({
      ...defaultHeldEventListSearch,
      minMatchCount: 2,
      pageSize: 25,
    });
  });

  it("removes each applied condition with its chip", () => {
    const applied: HeldEventListSearch = {
      ...scoped,
      from: "2026-04-01",
      metric: { memberId: "", metric: "rank1_count", range: "gte", value: "1" },
      minMatchCount: 3,
    };
    expect(
      changeHeldEventListSelection(applied, { kind: "removeCondition", condition: "period" }),
    ).toMatchObject({ from: "", to: "" });
    expect(
      changeHeldEventListSelection(applied, { kind: "removeCondition", condition: "matchCount" }),
    ).toMatchObject({ minMatchCount: 0 });
    expect(
      changeHeldEventListSelection(applied, { kind: "removeCondition", condition: "metric" })
        ?.metric,
    ).toEqual(emptyHeldEventListMetricCondition);
  });
});

describe("clearHeldEventListConditions", () => {
  it("keeps the reader's sort and page size", () => {
    expect(clearHeldEventListConditions(scoped)).toEqual({
      ...defaultHeldEventListSearch,
      pageSize: 25,
      sort: "held_asc",
    });
  });
});
