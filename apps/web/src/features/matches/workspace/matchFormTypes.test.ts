// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";

describe("createEmptyMatchForm", () => {
  it("preserves the workspace owner, player slot, playOrder, and rank defaults", () => {
    const form = createEmptyMatchForm("2026-08-26T12:34:56.000Z");

    expect(form.ownerMemberId).toBe("member_ponta");
    expect(
      form.players.map(({ memberId, playOrder, rank }) => ({ memberId, playOrder, rank })),
    ).toEqual([
      { memberId: "member_ponta", playOrder: 1, rank: 1 },
      { memberId: "member_akane_mami", playOrder: 2, rank: 2 },
      { memberId: "member_otaka", playOrder: 3, rank: 3 },
      { memberId: "member_eu", playOrder: 4, rank: 4 },
    ]);
  });
});
