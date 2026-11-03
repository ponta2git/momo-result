// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fillRecordSetup, previousMatchSetup } from "@/shared/heldEvents/recordContext";
import { makeHeldEventDetailResponse } from "@/test/factories/heldEvents";

const titles = [{ id: "gt_2" }, { id: "gt_world" }];
const seasons2 = [
  { id: "s_aw", gameTitleId: "gt_2" },
  { id: "s_ss", gameTitleId: "gt_2" },
];
const maps2 = [
  { id: "m_east", gameTitleId: "gt_2" },
  { id: "m_west", gameTitleId: "gt_2" },
];
const empty = { gameTitleId: "", seasonMasterId: "", mapMasterId: "" };
const previous = { gameTitleId: "gt_2", seasonMasterId: "s_ss", mapMasterId: "m_west" };

describe("record setup defaults", () => {
  it("follows the held event's latest match, not its first or the lists' first entries", () => {
    const detail = makeHeldEventDetailResponse({
      matches: [3, 1, 2].map((matchNoInEvent) => ({
        gameTitleId: "gt_2",
        mapMasterId: matchNoInEvent === 3 ? "m_west" : "m_east",
        matchId: `match-${matchNoInEvent}`,
        matchNoInEvent,
        ownerMemberId: "member_ponta",
        playedAt: "2026-01-01T00:00:00.000Z",
        seasonMasterId: matchNoInEvent === 3 ? "s_ss" : "s_aw",
      })),
    });
    expect(previousMatchSetup(detail)).toEqual(previous);
    expect(previousMatchSetup(makeHeldEventDetailResponse())).toBeUndefined();

    expect(
      fillRecordSetup({ value: empty, previous, gameTitles: titles, seasons: [], maps: [] }),
    ).toEqual(previous);
  });

  it("chooses a lone candidate, and waits for the user among several", () => {
    expect(
      fillRecordSetup({
        value: empty,
        previous: undefined,
        gameTitles: titles,
        seasons: [],
        maps: [],
      }),
    ).toEqual({});
    expect(
      fillRecordSetup({
        value: empty,
        previous: undefined,
        gameTitles: [{ id: "gt_world" }],
        seasons: undefined,
        maps: undefined,
      }),
    ).toEqual({ gameTitleId: "gt_world" });
    // The lone シーズン and マップ count once their lists for the chosen 作品 are read.
    expect(
      fillRecordSetup({
        value: { ...empty, gameTitleId: "gt_world" },
        previous: undefined,
        gameTitles: titles,
        seasons: [{ id: "s_world", gameTitleId: "gt_world" }],
        maps: [{ id: "m_world", gameTitleId: "gt_world" }],
      }),
    ).toEqual({ seasonMasterId: "s_world", mapMasterId: "m_world" });
    expect(
      fillRecordSetup({
        value: { ...empty, gameTitleId: "gt_2" },
        previous: undefined,
        gameTitles: titles,
        seasons: seasons2,
        maps: maps2,
      }),
    ).toEqual({});
  });

  it("never replaces a filled choice, and ignores lists read for another 作品", () => {
    expect(
      fillRecordSetup({
        value: { gameTitleId: "gt_world", seasonMasterId: "", mapMasterId: "" },
        previous,
        gameTitles: titles,
        // Still the previous 作品's lists while the new ones load.
        seasons: [{ id: "s_aw", gameTitleId: "gt_2" }],
        maps: [{ id: "m_east", gameTitleId: "gt_2" }],
      }),
    ).toEqual({});
    expect(
      fillRecordSetup({
        value: { gameTitleId: "gt_2", seasonMasterId: "s_aw", mapMasterId: "" },
        previous,
        gameTitles: titles,
        seasons: seasons2,
        maps: maps2,
      }),
    ).toEqual({ mapMasterId: "m_west" });
    expect(
      fillRecordSetup({
        value: empty,
        previous: { ...previous, gameTitleId: "gt_removed" },
        gameTitles: titles,
        seasons: [],
        maps: [],
      }),
    ).toEqual({});
  });
});
