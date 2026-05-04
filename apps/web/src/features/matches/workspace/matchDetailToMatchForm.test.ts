import { describe, expect, it } from "vitest";

import type { MatchDetailResponse } from "@/features/matches/api";
import { matchDetailToMatchForm } from "@/features/matches/workspace/matchDetailToMatchForm";

function detail(overrides: Partial<MatchDetailResponse> = {}): MatchDetailResponse {
  return {
    matchId: "match-1",
    heldEventId: "held-1",
    matchNoInEvent: 2,
    gameTitleId: "gt_momotetsu_2",
    layoutFamily: "default",
    seasonMasterId: "season_current",
    ownerMemberId: "member_ponta",
    mapMasterId: "map_east",
    playedAt: "2026-04-04T12:34:56.000Z",
    createdByMemberId: "member_ponta",
    createdAt: "2026-04-04T13:00:00.000Z",
    ...overrides,
  };
}

const incidents = {
  destination: 1,
  plusStation: 2,
  minusStation: 3,
  cardStation: 4,
  cardShop: 5,
  suriNoGinji: 6,
};

describe("matchDetailToMatchForm", () => {
  it("populates top-level form fields from the detail response", () => {
    const values = matchDetailToMatchForm(
      detail({
        players: [
          {
            memberId: "member_ponta",
            playOrder: 1,
            rank: 1,
            totalAssetsManYen: 100,
            revenueManYen: 10,
            incidents,
          },
          {
            memberId: "member_akane_mami",
            playOrder: 2,
            rank: 2,
            totalAssetsManYen: 90,
            revenueManYen: 9,
            incidents,
          },
          {
            memberId: "member_otaka",
            playOrder: 3,
            rank: 3,
            totalAssetsManYen: 80,
            revenueManYen: 8,
            incidents,
          },
          {
            memberId: "member_eu",
            playOrder: 4,
            rank: 4,
            totalAssetsManYen: 70,
            revenueManYen: 7,
            incidents,
          },
        ],
      }),
    );

    expect(values.gameTitleId).toBe("gt_momotetsu_2");
    expect(values.heldEventId).toBe("held-1");
    expect(values.mapMasterId).toBe("map_east");
    expect(values.matchNoInEvent).toBe(2);
    expect(values.ownerMemberId).toBe("member_ponta");
    expect(values.seasonMasterId).toBe("season_current");
    expect(values.playedAt).toBe("2026-04-04T12:34:56.000Z");
  });

  it("sorts players by playOrder ascending", () => {
    const values = matchDetailToMatchForm(
      detail({
        players: [
          {
            memberId: "member_otaka",
            playOrder: 3,
            rank: 1,
            totalAssetsManYen: 100,
            revenueManYen: 10,
            incidents,
          },
          {
            memberId: "member_eu",
            playOrder: 1,
            rank: 4,
            totalAssetsManYen: 70,
            revenueManYen: 7,
            incidents,
          },
          {
            memberId: "member_ponta",
            playOrder: 4,
            rank: 2,
            totalAssetsManYen: 90,
            revenueManYen: 9,
            incidents,
          },
          {
            memberId: "member_akane_mami",
            playOrder: 2,
            rank: 3,
            totalAssetsManYen: 80,
            revenueManYen: 8,
            incidents,
          },
        ],
      }),
    );

    expect(values.players.map((player) => player.playOrder)).toEqual([1, 2, 3, 4]);
    expect(values.players.map((player) => player.memberId)).toEqual([
      "member_eu",
      "member_akane_mami",
      "member_otaka",
      "member_ponta",
    ]);
  });

  it("forwards player asset/revenue/incident values verbatim", () => {
    const values = matchDetailToMatchForm(
      detail({
        players: [
          {
            memberId: "member_ponta",
            playOrder: 1,
            rank: 1,
            totalAssetsManYen: 1234,
            revenueManYen: 567,
            incidents,
          },
          {
            memberId: "member_akane_mami",
            playOrder: 2,
            rank: 2,
            totalAssetsManYen: 90,
            revenueManYen: 9,
            incidents,
          },
          {
            memberId: "member_otaka",
            playOrder: 3,
            rank: 3,
            totalAssetsManYen: 80,
            revenueManYen: 8,
            incidents,
          },
          {
            memberId: "member_eu",
            playOrder: 4,
            rank: 4,
            totalAssetsManYen: 70,
            revenueManYen: 7,
            incidents,
          },
        ],
      }),
    );

    expect(values.players[0]!.totalAssetsManYen).toBe(1234);
    expect(values.players[0]!.revenueManYen).toBe(567);
    expect(values.players[0]!.incidents).toEqual(incidents);
  });

  it("pads to 4 players using fixedMembers when fewer players are returned", () => {
    const values = matchDetailToMatchForm(
      detail({
        players: [
          {
            memberId: "member_ponta",
            playOrder: 1,
            rank: 1,
            totalAssetsManYen: 100,
            revenueManYen: 10,
            incidents,
          },
          {
            memberId: "member_akane_mami",
            playOrder: 2,
            rank: 2,
            totalAssetsManYen: 90,
            revenueManYen: 9,
            incidents,
          },
        ],
      }),
    );

    expect(values.players).toHaveLength(4);
    expect(values.players[2]!.playOrder).toBe(3);
    expect(values.players[2]!.rank).toBe(3);
    expect(values.players[2]!.totalAssetsManYen).toBe(0);
    expect(values.players[2]!.revenueManYen).toBe(0);
    expect(values.players[2]!.incidents).toEqual({
      destination: 0,
      plusStation: 0,
      minusStation: 0,
      cardStation: 0,
      cardShop: 0,
      suriNoGinji: 0,
    });
  });

  it("returns 4 default players when the detail has no players", () => {
    const values = matchDetailToMatchForm(detail());

    expect(values.players).toHaveLength(4);
    expect(values.players.map((player) => player.playOrder)).toEqual([1, 2, 3, 4]);
    expect(values.players.map((player) => player.rank)).toEqual([1, 2, 3, 4]);
  });

  it("only includes draftIds keys whose corresponding fields are present", () => {
    const onlyTotalAssets = matchDetailToMatchForm(detail({ totalAssetsDraftId: "draft-ta" }));
    expect(onlyTotalAssets.draftIds).toEqual({ totalAssets: "draft-ta" });

    const allThree = matchDetailToMatchForm(
      detail({
        totalAssetsDraftId: "draft-ta",
        revenueDraftId: "draft-rev",
        incidentLogDraftId: "draft-incident",
      }),
    );
    expect(allThree.draftIds).toEqual({
      totalAssets: "draft-ta",
      revenue: "draft-rev",
      incidentLog: "draft-incident",
    });

    const none = matchDetailToMatchForm(detail());
    expect(none.draftIds).toEqual({});
  });
});
