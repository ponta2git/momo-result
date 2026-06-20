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
      new URLSearchParams("status=broken&sort=nope&page=2abc&pageSize=50x"),
    );
    expect(search).toEqual(defaultMatchListSearch);
  });

  it("serializes non-default values only", () => {
    const params = buildMatchListSearchParams({
      gameTitleId: "game-1",
      heldEventId: "",
      page: 2,
      pageSize: 50,
      seasonMasterId: "season-1",
      sort: "updated_desc",
      status: "needs_review",
    });

    expect(params.toString()).toBe(
      "status=needs_review&gameTitleId=game-1&page=2&pageSize=50&seasonMasterId=season-1&sort=updated_desc",
    );
  });
});
