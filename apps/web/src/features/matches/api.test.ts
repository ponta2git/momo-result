// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { confirmMatch, getMatchListSummary, listMatches } from "@/shared/api/matches";
import { setDevUser } from "@/test/auth";
import { setupMsw } from "@/test/msw/lifecycle";

setupMsw();

describe("matches api", () => {
  it("confirms match", async () => {
    setDevUser();

    await expect(
      confirmMatch(
        {
          heldEventId: "held-1",
          matchNoInEvent: 1,
          gameTitleId: "momotetsu_2",
          seasonMasterId: "season-current",
          ownerMemberId: "member_ponta",
          mapMasterId: "map-east",
          playedAt: "2026-01-01T00:00:00.000Z",
          draftIds: {},
          players: [],
        },
        { idempotencyKey: "confirm-match-key-1" },
      ),
    ).resolves.toMatchObject({ matchId: "match-1" });
  });

  it("loads paged match list and summary", async () => {
    setDevUser();

    await expect(
      listMatches({ page: 1, pageSize: 2, sort: "status_priority" }),
    ).resolves.toMatchObject({
      items: [{ id: "draft-running-1" }, { id: "draft-review-1" }],
      pagination: { page: 1, pageSize: 2, totalItems: 3, totalPages: 2 },
    });
    await expect(getMatchListSummary()).resolves.toMatchObject({
      incompleteCount: 2,
      needsReviewCount: 1,
      ocrRunningCount: 1,
      preConfirmCount: 1,
    });
  });
});
