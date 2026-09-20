// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { MatchListSourceItem } from "@/features/matches/list/matchListTypes";
import { toMatchListItemView } from "@/features/matches/list/matchListViewModel";

function buildItem(
  overrides: Partial<MatchListSourceItem> & { matchId?: string | undefined },
): MatchListSourceItem {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    gameTitleId: "game-1",
    gameTitleName: "桃鉄",
    seasonName: "春",
    mapName: "日本",
    heldAt: "2025-12-31T12:00:00Z",
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
  it("maps the confirmed-note presence marker without exposing note text", () => {
    const item = toMatchListItemView(buildItem({ hasNote: true }));
    expect(item.hasNote).toBe(true);
    expect(item.heldAt).toBe("2025-12-31T12:00:00Z");
    expect(item.mapName).toBe("日本");
    expect(item.gameTitleName).toBe("桃鉄");
    expect(item.seasonName).toBe("春");
    expect(item).not.toHaveProperty("noteBody");
  });

  it("maps draft rows to review actions and warning labels", () => {
    const item = toMatchListItemView(
      buildDraftItem({
        id: "draft-1",
        matchDraftId: "draft-1",
        status: "needs_review",
      }),
    );

    expect(item.kind).toBe("match_draft");
    expect(item.primaryAction.href).toBe("/review/draft-1");
    expect(item.statusLabel).toBe("要確認");
    expect(item.statusDescription).toContain("確認が必要");
  });
});
