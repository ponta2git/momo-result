import { describe, expect, it } from "vitest";

import {
  buildHeldEventPlayerRecaps,
  heldEventDraftAction,
  heldEventDraftScopeLabel,
  heldEventScopeLabel,
} from "@/features/heldEvents/heldEventDetailViewModel";
import type { HeldEventDraftResponse, HeldEventMatchResponse } from "@/shared/api/heldEvents";

const match = (
  matchNoInEvent: number,
  pontaRank: number,
  euRank: number,
): HeldEventMatchResponse => ({
  gameTitleId: "game-1",
  mapMasterId: "map-1",
  matchId: `match-${matchNoInEvent}`,
  matchNoInEvent,
  ownerMemberId: "member_ponta",
  playedAt: "2026-01-01T00:00:00.000Z",
  players: [
    {
      memberId: "member_ponta",
      playOrder: 1,
      rank: pontaRank,
      revenueManYen: 100,
      totalAssetsManYen: 1_000,
    },
    {
      memberId: "member_eu",
      playOrder: 2,
      rank: euRank,
      revenueManYen: 80,
      totalAssetsManYen: 800,
    },
  ],
  seasonMasterId: "season-1",
});

const draft = (status: string): HeldEventDraftResponse => ({
  matchDraftId: "draft/1",
  status,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("held event detail view model", () => {
  it("builds player recap in canonical result order and match-number order", () => {
    const recaps = buildHeldEventPlayerRecaps([match(2, 3, 1), match(1, 1, 4)]);

    expect(recaps).toEqual([
      {
        averageRank: 2.5,
        displayName: "いーゆー",
        matchCount: 2,
        memberId: "member_eu",
        ranks: [4, 1],
        wins: 1,
      },
      {
        averageRank: 2,
        displayName: "ぽんた",
        matchCount: 2,
        memberId: "member_ponta",
        ranks: [1, 3],
        wins: 1,
      },
    ]);
  });

  it("selects a safe continuation route for every active draft status", () => {
    expect(heldEventDraftAction(draft("ocr_running"))).toEqual({ label: "読み取り中" });
    expect(heldEventDraftAction(draft("ocr_failed"))).toEqual({
      href: "/matches/new?matchDraftId=draft%2F1",
      label: "手入力で続ける",
    });
    expect(heldEventDraftAction(draft("needs_review"))).toEqual({
      href: "/review/draft%2F1",
      label: "確認事項を直す",
    });
  });

  it("resolves scope names without exposing unknown internal ids", () => {
    const names = {
      gameTitles: new Map([["game-1", "桃太郎電鉄2"]]),
      maps: new Map<string, string>(),
      seasons: new Map([["season-1", "今シーズン"]]),
    };

    expect(heldEventScopeLabel(match(1, 1, 2), names)).toBe(
      "桃太郎電鉄2 / 今シーズン / マップ名未取得",
    );
    expect(
      heldEventDraftScopeLabel(
        {
          gameTitleId: "game-1",
          seasonMasterId: "season-1",
        },
        names,
      ),
    ).toBe("桃太郎電鉄2 / 今シーズン");

    expect(
      heldEventDraftScopeLabel(
        {
          gameTitleId: "gt_missing",
          mapMasterId: "map_missing",
          seasonMasterId: "season_missing",
        },
        names,
      ),
    ).toBe("作品名未取得 / シーズン名未取得 / マップ名未取得");
  });
});
