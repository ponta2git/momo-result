// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { confirmMatch } from "@/shared/api/matches";
import { setupMsw } from "@/test/msw/lifecycle";

setupMsw();

describe("matches api", () => {
  it("confirms match", async () => {
    window.localStorage.setItem("momoresult.devUser", "account_ponta");

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
});
