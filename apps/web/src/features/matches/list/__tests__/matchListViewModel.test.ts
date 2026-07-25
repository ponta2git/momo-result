// @vitest-environment node
import { describe, expect, it } from "vitest";

import type {
  MatchListLookupMaps,
  MatchListSourceItem,
} from "@/features/matches/list/matchListTypes";
import { toMatchListItemView } from "@/features/matches/list/matchListViewModel";
import { makeHeldEventResponse } from "@/test/factories";

const lookupMaps: MatchListLookupMaps = {
  gameTitlesById: new Map([
    [
      "game-1",
      {
        id: "game-1",
        name: "桃鉄",
        layoutFamily: "momotetsu_2",
        displayOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]),
  heldEventsById: new Map([["held-1", makeHeldEventResponse({ matchCount: 3 })]]),
  mapsById: new Map([
    [
      "map-1",
      {
        id: "map-1",
        gameTitleId: "game-1",
        name: "日本",
        displayOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]),
  seasonsById: new Map([
    [
      "season-1",
      {
        id: "season-1",
        gameTitleId: "game-1",
        name: "春",
        displayOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]),
};

function buildItem(
  overrides: Partial<MatchListSourceItem> & { matchId?: string | undefined },
): MatchListSourceItem {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    gameTitleId: "game-1",
    heldEventId: "held-1",
    id: "item-1",
    kind: "match",
    mapMasterId: "map-1",
    matchId: "match-1",
    matchNoInEvent: 1,
    ownerMemberId: "member_ponta",
    playedAt: "2026-01-01T00:00:00.000Z",
    ranks: [{ memberId: "member_ponta", playOrder: 1, rank: 1 }],
    seasonMasterId: "season-1",
    status: "confirmed",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function buildDraftItem(
  overrides: Partial<MatchListSourceItem> & { matchDraftId: string },
): MatchListSourceItem {
  const { matchId: _unusedMatchId, ...item } = buildItem({
    ...overrides,
    kind: "match_draft",
  });
  return item;
}

describe("matchListViewModel", () => {
  it("maps draft rows to review actions and warning labels", () => {
    const item = toMatchListItemView(
      buildDraftItem({
        id: "draft-1",
        matchDraftId: "draft-1",
        status: "needs_review",
      }),
      lookupMaps,
    );

    expect(item.kind).toBe("match_draft");
    expect(item.primaryAction.href).toBe("/review/draft-1");
    expect(item.statusDescription).toContain("確認が必要");
  });
});
