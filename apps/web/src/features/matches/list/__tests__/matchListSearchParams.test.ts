// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  buildMatchListSearchParams,
  defaultMatchListSearch,
  parseMatchListSearchParams,
} from "@/features/matches/list/matchListSearchParams";

describe("matchListSearchParams", () => {
  it("parses defaults when query values are missing or invalid", () => {
    const search = parseMatchListSearchParams(
      new URLSearchParams("status=broken&sort=nope&pageSize=50x"),
    );
    expect(search).toEqual(defaultMatchListSearch);
  });

  it("normalizes unsupported page sizes to the default page size", () => {
    const search = parseMatchListSearchParams(new URLSearchParams("pageSize=100"));

    expect(search.pageSize).toBe(10);
  });

  it("uses newest held event first as the normal list order", () => {
    expect(defaultMatchListSearch.sort).toBe("held_desc");
    expect(buildMatchListSearchParams(defaultMatchListSearch).toString()).toBe("");
  });

  it("trims filter ids and treats blank ids as defaults", () => {
    const search = parseMatchListSearchParams(
      new URLSearchParams("gameTitleId=%20game-1%20&heldEventId=%20&seasonMasterId=%20season-1%20"),
    );

    expect(search).toMatchObject({
      gameTitleId: "game-1",
      heldEventId: "",
      seasonMasterId: "season-1",
    });
  });

  it("serializes non-default values only", () => {
    const params = buildMatchListSearchParams({
      gameTitleId: "game-1",
      heldEventId: "",
      cursor: "opaque-cursor",
      pageSize: 50,
      seasonMasterId: "season-1",
      sort: "updated_desc",
      status: "needs_review",
    });

    expect(params.toString()).toBe(
      "status=needs_review&gameTitleId=game-1&cursor=opaque-cursor&pageSize=50&seasonMasterId=season-1&sort=updated_desc",
    );
  });

  it("drops cursor values above the API codec bound", () => {
    const search = parseMatchListSearchParams(new URLSearchParams({ cursor: "x".repeat(4097) }));

    expect(search.cursor).toBe("");
  });
});
