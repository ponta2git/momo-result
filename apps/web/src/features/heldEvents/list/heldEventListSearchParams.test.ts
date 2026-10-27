// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildHeldEventListApiQuery } from "@/features/heldEvents/list/heldEventListQuery";
import {
  buildHeldEventListSearchParams,
  defaultHeldEventListSearch,
  emptyHeldEventListMetricCondition,
  hasHeldEventListConditions,
  parseHeldEventListSearchParams,
} from "@/features/heldEvents/list/heldEventListSearchParams";

describe("heldEventListSearchParams", () => {
  it("parses defaults when query values are missing or invalid", () => {
    const search = parseHeldEventListSearchParams(
      new URLSearchParams(
        "sort=updated_desc&page=0&pageSize=100&from=2026-02-30&to=nope&minMatchCount=7" +
          "&metric=broken&metricValue=1",
      ),
    );
    expect(search).toEqual(defaultHeldEventListSearch);
    expect(hasHeldEventListConditions(search)).toBe(false);
  });

  it("round-trips a full search in canonical order", () => {
    const query =
      "gameTitleId=game-1&seasonMasterId=season-1&mapMasterId=map-1" +
      "&from=2026-01-01&to=2026-03-31&minMatchCount=3&q=%E3%83%9C%E3%83%B3%E3%83%93%E3%83%BC" +
      "&memberId=member_ponta&metric=average_rank&metricValue=2.5&metricRange=lte" +
      "&sort=held_asc&page=2&pageSize=25";
    const search = parseHeldEventListSearchParams(new URLSearchParams(query));

    expect(search).toMatchObject({
      metric: { memberId: "member_ponta", metric: "average_rank", range: "lte", value: "2.5" },
      minMatchCount: 3,
      page: 2,
      pageSize: 25,
      q: "ボンビー",
    });
    expect(hasHeldEventListConditions(search)).toBe(true);
    expect(buildHeldEventListSearchParams(search).toString()).toBe(query);
  });

  it("drops an inverted period instead of guessing which end was meant", () => {
    const search = parseHeldEventListSearchParams(
      new URLSearchParams("from=2026-04-01&to=2026-03-31"),
    );

    expect(search).toMatchObject({ from: "", to: "" });
  });

  it.each([
    ["an average above 4", "metric=average_rank&metricValue=4.01"],
    ["an average below 1", "metric=average_rank&metricValue=0.99"],
    ["an average with three decimals", "metric=average_rank&metricValue=2.505"],
    ["a negative count", "metric=rank1_count&metricValue=-1"],
    ["a fractional count", "metric=rank2_count&metricValue=1.5"],
    ["a missing value", "metric=rank3_count"],
    ["a value without a metric", "memberId=member_ponta&metricValue=2"],
  ])("drops a metric condition with %s", (_, query) => {
    expect(parseHeldEventListSearchParams(new URLSearchParams(query)).metric).toEqual(
      emptyHeldEventListMetricCondition,
    );
  });

  it("canonicalizes a count and treats an unknown member as any player", () => {
    const search = parseHeldEventListSearchParams(
      new URLSearchParams("memberId=someone&metric=rank4_count&metricValue=03"),
    );

    expect(search.metric).toEqual({
      memberId: "",
      metric: "rank4_count",
      range: "gte",
      value: "3",
    });
  });

  it("drops memo queries above the API bound", () => {
    const search = parseHeldEventListSearchParams(new URLSearchParams({ q: "あ".repeat(51) }));

    expect(search.q).toBe("");
  });
});

describe("buildHeldEventListApiQuery", () => {
  it("keeps the unconditioned read identical to the established page request", () => {
    expect(buildHeldEventListApiQuery(defaultHeldEventListSearch)).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it("sends every applied condition and the metric only as a complete condition", () => {
    expect(
      buildHeldEventListApiQuery({
        ...defaultHeldEventListSearch,
        from: "2026-04-01",
        gameTitleId: "game-1",
        metric: { memberId: "", metric: "rank1_count", range: "gte", value: "2" },
        minMatchCount: 3,
        q: "ボンビー",
        sort: "held_asc",
      }),
    ).toEqual({
      from: "2026-04-01",
      gameTitleId: "game-1",
      metric: "rank1_count",
      metricRange: "gte",
      metricValue: "2",
      minMatchCount: 3,
      page: 1,
      pageSize: 10,
      q: "ボンビー",
      sort: "held_asc",
    });
    expect(
      buildHeldEventListApiQuery({
        ...defaultHeldEventListSearch,
        metric: { memberId: "member_eu", metric: "average_rank", range: "lte", value: "" },
      }),
    ).toEqual({ page: 1, pageSize: 10 });
  });
});
