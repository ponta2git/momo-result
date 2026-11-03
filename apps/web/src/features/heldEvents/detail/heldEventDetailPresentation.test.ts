// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildHeldEventDetailView,
  buildHeldEventPlayerRecaps,
  buildHeldEventDraftActionView,
  heldEventDraftScopeLabel,
  heldEventScopeLabel,
} from "@/features/heldEvents/detail/heldEventDetailPresentation";
import type { DetailNavigation, HeldEventNeighbor } from "@/shared/api/detailReadResult";
import type { HeldEventDraftResponse, HeldEventMatchResponse } from "@/shared/api/heldEvents";
import { makeHeldEventDetailResponse } from "@/test/factories/heldEvents";

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

function recordingHintFor(
  navigation: DetailNavigation<HeldEventNeighbor>,
  records: Pick<Parameters<typeof makeHeldEventDetailResponse>[0] & object, "drafts" | "matches">,
) {
  const view = buildHeldEventDetailView({
    heldEventId: "held-1",
    detail: makeHeldEventDetailResponse(records),
    navigation,
    notFound: false,
    error: undefined,
    pending: false,
    initialPending: false,
    stale: false,
    refresh: { pending: false, run: () => undefined },
  });
  return view.kind === "ready" ? view.navigation.recordingHint : "not ready";
}

describe("held event detail presentation", () => {
  it("records into the newest held event, and offers a new one only beside its records", () => {
    const newer = { id: "held-2", heldAt: "2026-01-08T13:00:00.000Z" };
    const newest = { kind: "available", previous: undefined, next: undefined } as const;
    // An older night points to the newest event, whatever it holds.
    expect(
      recordingHintFor({ kind: "available", previous: undefined, next: newer }, { matches: [] }),
    ).toEqual({ kind: "toNewest", href: "/" });
    // An empty newest event, like the one Summit prepares before play, takes the night's matches.
    expect(recordingHintFor(newest, { matches: [] })).toBeNull();
    expect(recordingHintFor(newest, { matches: [match(1, 1, 2)] })).toEqual({
      kind: "offerNewEvent",
    });
    expect(recordingHintFor(newest, { drafts: [draft("draft_ready")], matches: [] })).toEqual({
      kind: "offerNewEvent",
    });
    // Without its neighbors the hub cannot tell where it stands, so it claims neither.
    expect(recordingHintFor({ kind: "unavailable" }, { matches: [match(1, 1, 2)] })).toBeNull();
  });

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
    expect(buildHeldEventDraftActionView(draft("ocr_running"))).toEqual({ label: "読み取り中" });
    expect(buildHeldEventDraftActionView(draft("ocr_failed"))).toEqual({
      href: "/matches/new?matchDraftId=draft%2F1",
      label: "手入力で続ける",
    });
    expect(buildHeldEventDraftActionView(draft("needs_review"))).toEqual({
      href: "/review/draft%2F1",
      label: "確認事項を直す",
    });
  });

  it("resolves scope names without exposing unknown internal ids", () => {
    expect(
      heldEventScopeLabel({
        ...match(1, 1, 2),
        gameTitleName: "桃太郎電鉄2",
        seasonName: "今シーズン",
      }),
    ).toBe("桃太郎電鉄2・今シーズン・マップ名未取得");
    expect(
      heldEventDraftScopeLabel({
        gameTitleId: "game-1",
        gameTitleName: "桃太郎電鉄2",
        seasonName: "今シーズン",
        seasonMasterId: "season-1",
      }),
    ).toBe("桃太郎電鉄2・今シーズン");

    expect(
      heldEventDraftScopeLabel({
        gameTitleId: "gt_missing",
        mapMasterId: "map_missing",
        seasonMasterId: "season_missing",
      }),
    ).toBe("作品名未取得・シーズン名未取得・マップ名未取得");
  });
});
