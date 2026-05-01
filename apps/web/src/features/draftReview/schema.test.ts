import { describe, expect, it } from "vitest";

import { confirmMatchSchema } from "@/features/draftReview/schema";

const valid = {
  heldEventId: "held-1",
  matchNoInEvent: 1,
  gameTitleId: "momotetsu_2",
  seasonMasterId: "season-current",
  ownerMemberId: "member_ponta",
  mapMasterId: "map-east",
  playedAt: "2026-01-01T00:00:00.000Z",
  draftIds: {},
  players: [
    {
      memberId: "member_ponta",
      playOrder: 1,
      rank: 1,
      totalAssetsManYen: 100,
      revenueManYen: 10,
      incidents: {
        destination: 0,
        plusStation: 0,
        minusStation: 0,
        cardStation: 0,
        cardShop: 0,
        suriNoGinji: 0,
      },
    },
    {
      memberId: "member_akane_mami",
      playOrder: 2,
      rank: 2,
      totalAssetsManYen: 90,
      revenueManYen: 9,
      incidents: {
        destination: 0,
        plusStation: 0,
        minusStation: 0,
        cardStation: 0,
        cardShop: 0,
        suriNoGinji: 0,
      },
    },
    {
      memberId: "member_otaka",
      playOrder: 3,
      rank: 3,
      totalAssetsManYen: 80,
      revenueManYen: 8,
      incidents: {
        destination: 0,
        plusStation: 0,
        minusStation: 0,
        cardStation: 0,
        cardShop: 0,
        suriNoGinji: 0,
      },
    },
    {
      memberId: "member_eu",
      playOrder: 4,
      rank: 4,
      totalAssetsManYen: 70,
      revenueManYen: 7,
      incidents: {
        destination: 0,
        plusStation: 0,
        minusStation: 0,
        cardStation: 0,
        cardShop: 0,
        suriNoGinji: 0,
      },
    },
  ],
} as const;

describe("confirmMatchSchema", () => {
  it("accepts a complete fixed-four-player result", () => {
    expect(confirmMatchSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects duplicated ranks", () => {
    const result = confirmMatchSchema.safeParse({
      ...valid,
      players: valid.players.map((player, index) =>
        index === 1 ? { ...player, rank: 1 } : player,
      ),
    });

    expect(result.success).toBe(false);
  });
});
