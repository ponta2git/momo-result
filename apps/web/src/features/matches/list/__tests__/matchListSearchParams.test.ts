// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildMatchListApiQuery } from "@/features/matches/list/matchListQuery";
import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  emptyMatchListRecordCondition,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";

describe("matchListSearchParams", () => {
  it("parses defaults when query values are missing or invalid", () => {
    const search = parseMatchListSearchParams(
      new URLSearchParams(
        "status=confirmed&sort=updated_desc&pageSize=10&from=2026-02-30&to=nope&record=broken&recordValue=1",
      ),
    );
    expect(search).toEqual(defaultMatchListSearch);
  });

  it("round-trips a full search in canonical order", () => {
    const query =
      "gameTitleId=game-1&seasonMasterId=season-1&mapMasterId=map-1&heldEventId=held-1" +
      "&from=2026-01-01&to=2026-03-31&q=%E3%83%9C%E3%83%B3%E3%83%93%E3%83%BC" +
      "&memberId=member_ponta&record=suri_no_ginji&recordValue=1&recordRange=lte" +
      "&sort=held_asc&cursor=opaque&pageSize=50";
    const search = parseMatchListSearchParams(new URLSearchParams(query));

    expect(search).toMatchObject({
      q: "ボンビー",
      record: { memberId: "member_ponta", range: "lte", record: "suri_no_ginji", value: "1" },
    });
    expect(buildMatchListSearchParams(search).toString()).toBe(query);
  });

  it("drops an inverted period instead of guessing which end was meant", () => {
    const search = parseMatchListSearchParams(new URLSearchParams("from=2026-04-01&to=2026-03-31"));

    expect(search).toMatchObject({ from: "", to: "" });
  });

  it.each([
    ["a negative incident count", "record=destination&recordValue=-1"],
    ["a fractional amount", "record=total_assets&recordValue=1.5"],
    ["a missing value", "record=revenue"],
  ])("drops a record condition with %s", (_, query) => {
    expect(parseMatchListSearchParams(new URLSearchParams(query)).record).toEqual(
      emptyMatchListRecordCondition,
    );
  });

  it("keeps a negative revenue and treats an unknown member as any player", () => {
    const search = parseMatchListSearchParams(
      new URLSearchParams("memberId=someone&record=revenue&recordValue=-500"),
    );

    expect(search.record).toEqual({ memberId: "", range: "gte", record: "revenue", value: "-500" });
  });

  it("drops memo queries above the API bound", () => {
    const search = parseMatchListSearchParams(new URLSearchParams({ q: "あ".repeat(51) }));

    expect(search.q).toBe("");
  });

  it("drops cursor values above the API codec bound", () => {
    const search = parseMatchListSearchParams(new URLSearchParams({ cursor: "x".repeat(4097) }));

    expect(search.cursor).toBe("");
  });
});

describe("buildMatchListApiQuery", () => {
  it("always reads confirmed matches and sends a record only as a complete condition", () => {
    expect(
      buildMatchListApiQuery({
        ...defaultMatchListSearch,
        record: { memberId: "member_eu", range: "lte", record: "revenue", value: "-500" },
      }),
    ).toEqual({
      kind: "match",
      memberId: "member_eu",
      pageSize: 25,
      record: "revenue",
      recordRange: "lte",
      recordValue: -500,
      sort: "held_desc",
      status: "confirmed",
    });
  });
});
