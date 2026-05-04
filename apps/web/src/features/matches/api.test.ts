import { describe, expect, it } from "vitest";

import { confirmMatch } from "@/features/matches/api";

describe("matches api", () => {
  it("confirms match", async () => {
    window.localStorage.setItem("momoresult.devUser", "ponta");

    await expect(
      confirmMatch({
        heldEventId: "held-1",
        matchNoInEvent: 1,
        gameTitleId: "momotetsu_2",
        seasonMasterId: "season-current",
        ownerMemberId: "member_ponta",
        mapMasterId: "map-east",
        playedAt: "2026-01-01T00:00:00.000Z",
        draftIds: {},
        players: [],
      }),
    ).resolves.toMatchObject({ matchId: "match-1" });
  });
});
